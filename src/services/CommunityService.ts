import type {
  CommunityAuthorPublic,
  CommunityComment,
  CommunityPostDetail,
  CommunityPostSummary,
  CommunityVisibilityType,
  CreateCommunityCommentInput,
  CreateCommunityPostInput,
  CreateCommunityReportInput,
  ListCommunityPostsQuery,
  VoteOnPostInput,
  VoteValue,
} from '@/types/Community';

import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  communityCommentSchema,
  communityPostSchema,
  communityReportSchema,
  communityVoteSchema,
  doctorVerificationApplicationSchema,
  DoctorVerificationApplicationStatus,
  episodeSchema,
  userSchema,
} from '@/models/Schema';

import { moderationService } from './ModerationService';

type DbUser = typeof userSchema.$inferSelect;

function mapAuthorPublic(
  user: (DbUser & { doctorSpecialty?: string | null }) | undefined,
  isAnonymous: boolean,
): CommunityAuthorPublic {
  if (!user || isAnonymous) {
    return {
      displayName: null,
      isDoctor: false,
      isDoctorVerified: false,
      doctorSpecialty: null,
      isAnonymous: true,
    };
  }

  // Use displayName as the primary display name, fall back to communityHandle for backwards compatibility
  const displayName = user.displayName && user.displayName.length > 0
    ? user.displayName
    : user.communityHandle;

  return {
    displayName: displayName ?? null,
    // Feature F13: badge visibility is server-side enforced via user.role
    isDoctor: user.role === 'doctor_pending'
      || user.role === 'doctor_verified'
      || user.role === 'doctor_rejected',
    isDoctorVerified: user.role === 'doctor_verified',
    doctorSpecialty: user.role === 'doctor_verified'
      ? ((user.doctorSpecialty as any) ?? null)
      : null,
    isAnonymous: false,
  };
}

function parseTags(tags: string | null): string[] {
  if (!tags) {
    return [];
  }
  return tags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0);
}

function serializeTags(tags: string[] | undefined): string | null {
  if (!tags || tags.length === 0) {
    return null;
  }
  return tags.join(',');
}

export class CommunityService {
  async createPost(
    authorId: string,
    input: CreateCommunityPostInput,
  ): Promise<CommunityPostDetail> {
    if (input.episodeId) {
      const [episode] = await db
        .select({ id: episodeSchema.id, userId: episodeSchema.userId })
        .from(episodeSchema)
        .where(
          and(
            eq(episodeSchema.id, input.episodeId),
            eq(episodeSchema.userId, authorId),
          ),
        )
        .limit(1);

      if (!episode) {
        logger.warn(
          { authorId, episodeId: input.episodeId },
          'Attempt to share episode that does not belong to user',
        );
        throw new Error('EPISODE_NOT_FOUND_OR_FORBIDDEN');
      }
    }

    const [created] = await db
      .insert(communityPostSchema)
      .values({
        authorId,
        episodeId: input.episodeId ?? null,
        title: input.title,
        body: input.body,
        tags: serializeTags(input.tags),
        isAnonymous: input.isAnonymous,
        isFromEpisode: !!input.episodeId,
      })
      .returning();

    if (!created) {
      throw new Error('FAILED_TO_CREATE_POST');
    }

    logger.info(
      { postId: created.id, authorId, hasEpisode: !!input.episodeId },
      'Community post created',
    );

    const detail = await this.getPostWithComments(authorId, created.id);
    if (!detail) {
      throw new Error('FAILED_TO_LOAD_CREATED_POST');
    }
    return detail;
  }

  async listPosts(
    viewerUserId: string | null,
    query: ListCommunityPostsQuery,
  ): Promise<CommunityPostSummary[]> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;

    // Check if viewer is a moderator
    const isModerator = viewerUserId
      ? await moderationService.isModerator(viewerUserId)
      : false;

    // Moderators can see HIDDEN content, normal users only see PUBLIC
    const visibilityCondition = isModerator
      ? or(
          eq(communityPostSchema.visibility, 'PUBLIC'),
          eq(communityPostSchema.visibility, 'HIDDEN'),
        )
      : eq(communityPostSchema.visibility, 'PUBLIC');

    const conditions = [visibilityCondition] as any[];

    if (query.tag) {
      conditions.push(
        like(communityPostSchema.tags, `%${query.tag}%`),
      );
    }

    if (query.onlyOwn && viewerUserId) {
      conditions.push(
        eq(communityPostSchema.authorId, viewerUserId),
      );
    }

    const where = and(...conditions);

    const orderByNew = [desc(communityPostSchema.createdAt)] as const;
    const orderByTop = [
      desc(communityPostSchema.score),
      desc(communityPostSchema.createdAt),
    ] as const;

    const rows = await db
      .select({
        id: communityPostSchema.id,
        title: communityPostSchema.title,
        body: communityPostSchema.body,
        episodeId: communityPostSchema.episodeId,
        tags: communityPostSchema.tags,
        score: communityPostSchema.score,
        isFromEpisode: communityPostSchema.isFromEpisode,
        isAnonymous: communityPostSchema.isAnonymous,
        createdAt: communityPostSchema.createdAt,
        authorId: communityPostSchema.authorId,
        visibility: communityPostSchema.visibility,
        userId: userSchema.id,
        displayName: userSchema.displayName,
        communityHandle: userSchema.communityHandle,
        userRole: userSchema.role,
        doctorSpecialty: doctorVerificationApplicationSchema.specialty,
      })
      .from(communityPostSchema)
      .leftJoin(userSchema, eq(communityPostSchema.authorId, userSchema.id))
      .leftJoin(
        doctorVerificationApplicationSchema,
        and(
          eq(doctorVerificationApplicationSchema.userId, userSchema.id),
          eq(
            doctorVerificationApplicationSchema.status,
            DoctorVerificationApplicationStatus.APPROVED,
          ),
        ),
      )
      .where(where)
      .orderBy(
        ...(query.sort === 'top' ? orderByTop : orderByNew),
      )
      .limit(limit)
      .offset(offset);

    const postIds = rows.map(r => r.id);

    let voteByPostId: Record<string, VoteValue> = {};
    let commentCountByPostId: Record<string, number> = {};
    if (viewerUserId && postIds.length > 0) {
      const votes = await db
        .select({
          postId: communityVoteSchema.postId,
          value: communityVoteSchema.value,
        })
        .from(communityVoteSchema)
        .where(
          and(
            eq(communityVoteSchema.userId, viewerUserId),
            inArray(communityVoteSchema.postId, postIds),
          ),
        );

      voteByPostId = votes.reduce<Record<string, VoteValue>>((acc, v) => {
        acc[v.postId] = (v.value as VoteValue) ?? 0;
        return acc;
      }, {});
    }

    if (postIds.length > 0) {
      const commentCounts = await db
        .select({
          postId: communityCommentSchema.postId,
          count: sql<number>`count(*)`,
        })
        .from(communityCommentSchema)
        .where(
          inArray(communityCommentSchema.postId, postIds),
        )
        .groupBy(communityCommentSchema.postId);

      commentCountByPostId = commentCounts.reduce<Record<string, number>>(
        (acc, row) => {
          acc[row.postId] = Number(row.count) || 0;
          return acc;
        },
        {},
      );
    }

    // Get report counts for each post if moderator
    let reportCountByPostId: Record<string, number> = {};
    if (isModerator && postIds.length > 0) {
      const reportCounts = await db
        .select({
          postId: communityReportSchema.postId,
          count: sql<number>`count(*)`,
        })
        .from(communityReportSchema)
        .where(
          and(
            inArray(communityReportSchema.postId, postIds),
            eq(communityReportSchema.status, 'OPEN'),
          ),
        )
        .groupBy(communityReportSchema.postId);

      reportCountByPostId = reportCounts.reduce<Record<string, number>>(
        (acc, row) => {
          if (row.postId) {
            acc[row.postId] = Number(row.count) || 0;
          }
          return acc;
        },
        {},
      );
    }

    return rows.map((row) => {
      const tags = parseTags(row.tags);
      const bodyPreview
        = row.body.length > 240 ? `${row.body.slice(0, 240)}…` : row.body;

      // TODO: Enrich also with authorId when post is not anonymous
      const user: (DbUser & { doctorSpecialty?: string | null }) | undefined = row.userId
        ? {
            id: row.userId,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            stripeSubscriptionPriceId: null,
            stripeSubscriptionStatus: null,
            stripeSubscriptionCurrentPeriodEnd: null,
            displayName: row.displayName ?? '',
            preferredLanguage: 'en',
            themePreference: 'light',
            communityHandle: row.communityHandle ?? null,
            isDoctor: false,
            isDoctorVerified: false,
            role: row.userRole ?? 'user',
            createdAt: new Date(),
            updatedAt: new Date(),
            doctorSpecialty: (row.doctorSpecialty as any) ?? null,
          }
        : undefined;

      const summary: CommunityPostSummary = {
        id: row.id,
        title: row.title,
        bodyPreview,
        score: row.score ?? 0,
        episodeId: row.episodeId ?? null,
        tags,
        isFromEpisode: row.isFromEpisode,
        createdAt: row.createdAt.toISOString(),
        author: mapAuthorPublic(user, row.isAnonymous),
        viewerVote: voteByPostId[row.id] ?? 0,
        commentCount: commentCountByPostId[row.id] ?? 0,
        isMine: viewerUserId ? row.authorId === viewerUserId : false,
      };

      // Add moderation fields for moderators
      if (isModerator) {
        summary.visibility = row.visibility as CommunityVisibilityType;
        summary.reportCount = reportCountByPostId[row.id] ?? 0;
      }

      return summary;
    });
  }

  async getPostWithComments(
    viewerUserId: string | null,
    postId: string,
  ): Promise<CommunityPostDetail | null> {
    // Check if viewer is a moderator
    const isModerator = viewerUserId
      ? await moderationService.isModerator(viewerUserId)
      : false;

    // Moderators can see HIDDEN content, normal users only see PUBLIC
    const visibilityCondition = isModerator
      ? or(
          eq(communityPostSchema.visibility, 'PUBLIC'),
          eq(communityPostSchema.visibility, 'HIDDEN'),
        )
      : eq(communityPostSchema.visibility, 'PUBLIC');

    const [row] = await db
      .select({
        id: communityPostSchema.id,
        title: communityPostSchema.title,
        body: communityPostSchema.body,
        tags: communityPostSchema.tags,
        score: communityPostSchema.score,
        isFromEpisode: communityPostSchema.isFromEpisode,
        episodeId: communityPostSchema.episodeId,
        isAnonymous: communityPostSchema.isAnonymous,
        createdAt: communityPostSchema.createdAt,
        updatedAt: communityPostSchema.updatedAt,
        authorId: communityPostSchema.authorId,
        visibility: communityPostSchema.visibility,
        userId: userSchema.id,
        displayName: userSchema.displayName,
        communityHandle: userSchema.communityHandle,
        userRole: userSchema.role,
        doctorSpecialty: doctorVerificationApplicationSchema.specialty,
      })
      .from(communityPostSchema)
      .leftJoin(userSchema, eq(communityPostSchema.authorId, userSchema.id))
      .leftJoin(
        doctorVerificationApplicationSchema,
        and(
          eq(doctorVerificationApplicationSchema.userId, userSchema.id),
          eq(
            doctorVerificationApplicationSchema.status,
            DoctorVerificationApplicationStatus.APPROVED,
          ),
        ),
      )
      .where(
        and(
          eq(communityPostSchema.id, postId),
          visibilityCondition,
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    let viewerVote: VoteValue = 0;
    if (viewerUserId) {
      const [vote] = await db
        .select({ value: communityVoteSchema.value })
        .from(communityVoteSchema)
        .where(
          and(
            eq(communityVoteSchema.postId, postId),
            eq(communityVoteSchema.userId, viewerUserId),
          ),
        )
        .limit(1);
      viewerVote = (vote?.value as VoteValue) ?? 0;
    }

    const user: (DbUser & { doctorSpecialty?: string | null }) | undefined = !row.isAnonymous
      ? {
          id: row.authorId!,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripeSubscriptionPriceId: null,
          stripeSubscriptionStatus: null,
          stripeSubscriptionCurrentPeriodEnd: null,
          displayName: row.displayName ?? '',
          preferredLanguage: 'en',
          themePreference: 'light',
          communityHandle: row.communityHandle ?? null,
          isDoctor: false,
          isDoctorVerified: false,
          role: row.userRole ?? 'user',
          createdAt: new Date(),
          updatedAt: new Date(),
          doctorSpecialty: (row.doctorSpecialty as any) ?? null,
        }
      : undefined;

    const author = mapAuthorPublic(user, row.isAnonymous);

    const tags = parseTags(row.tags);

    // Moderators can see HIDDEN comments, normal users only see PUBLIC
    const commentVisibilityCondition = isModerator
      ? or(
          eq(communityCommentSchema.visibility, 'PUBLIC'),
          eq(communityCommentSchema.visibility, 'HIDDEN'),
        )
      : eq(communityCommentSchema.visibility, 'PUBLIC');

    const commentsRows = await db
      .select({
        id: communityCommentSchema.id,
        postId: communityCommentSchema.postId,
        parentCommentId: communityCommentSchema.parentCommentId,
        body: communityCommentSchema.body,
        isAnonymous: communityCommentSchema.isAnonymous,
        createdAt: communityCommentSchema.createdAt,
        commentAuthorId: communityCommentSchema.authorId,
        visibility: communityCommentSchema.visibility,
        userId: userSchema.id,
        displayName: userSchema.displayName,
        communityHandle: userSchema.communityHandle,
        userRole: userSchema.role,
        doctorSpecialty: doctorVerificationApplicationSchema.specialty,
      })
      .from(communityCommentSchema)
      .leftJoin(userSchema, eq(communityCommentSchema.authorId, userSchema.id))
      .leftJoin(
        doctorVerificationApplicationSchema,
        and(
          eq(doctorVerificationApplicationSchema.userId, userSchema.id),
          eq(
            doctorVerificationApplicationSchema.status,
            DoctorVerificationApplicationStatus.APPROVED,
          ),
        ),
      )
      .where(
        and(
          eq(communityCommentSchema.postId, postId),
          commentVisibilityCondition,
        ),
      )
      .orderBy(communityCommentSchema.createdAt);

    const comments: CommunityComment[] = commentsRows.map((c) => {
      const commentUser: (DbUser & { doctorSpecialty?: string | null }) | undefined = c.userId
        ? {
            id: c.userId,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            stripeSubscriptionPriceId: null,
            stripeSubscriptionStatus: null,
            stripeSubscriptionCurrentPeriodEnd: null,
            displayName: c.displayName ?? '',
            preferredLanguage: 'en',
            themePreference: 'light',
            communityHandle: c.communityHandle ?? null,
            isDoctor: false,
            isDoctorVerified: false,
            role: c.userRole ?? 'user',
            createdAt: new Date(),
            updatedAt: new Date(),
            doctorSpecialty: (c.doctorSpecialty as any) ?? null,
          }
        : undefined;

      const comment: CommunityComment = {
        id: c.id,
        postId: c.postId,
        parentCommentId: c.parentCommentId ?? null,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        author: mapAuthorPublic(commentUser, c.isAnonymous),
      };

      // Add moderation fields for moderators
      if (isModerator) {
        comment.visibility = c.visibility as CommunityVisibilityType;
        comment.isMine = viewerUserId ? c.commentAuthorId === viewerUserId : false;
      }

      return comment;
    });

    // Get report count for moderators
    let reportCount = 0;
    if (isModerator) {
      reportCount = await moderationService.getReportCount(postId);
    }

    const detail: CommunityPostDetail = {
      id: row.id,
      title: row.title,
      body: row.body,
      score: row.score ?? 0,
      tags,
      isFromEpisode: row.isFromEpisode,
      episodeId: row.episodeId ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      author,
      viewerVote,
      comments,
    };

    // Add moderation fields for moderators
    if (isModerator) {
      detail.visibility = row.visibility as CommunityVisibilityType;
      detail.reportCount = reportCount;
    }

    return detail;
  }

  async voteOnPost(
    userId: string,
    postId: string,
    input: VoteOnPostInput,
  ): Promise<{ score: number; viewerVote: VoteValue } | null> {
    const { value } = input;

    const [post] = await db
      .select({
        id: communityPostSchema.id,
        score: communityPostSchema.score,
        visibility: communityPostSchema.visibility,
      })
      .from(communityPostSchema)
      .where(eq(communityPostSchema.id, postId))
      .limit(1);

    if (!post || post.visibility !== 'PUBLIC') {
      return null;
    }

    const [existing] = await db
      .select({
        id: communityVoteSchema.id,
        value: communityVoteSchema.value,
      })
      .from(communityVoteSchema)
      .where(
        and(
          eq(communityVoteSchema.postId, postId),
          eq(communityVoteSchema.userId, userId),
        ),
      )
      .limit(1);

    let newScore = post.score ?? 0;
    let viewerVote: VoteValue = 0;

    if (value === 0) {
      if (existing) {
        await db
          .delete(communityVoteSchema)
          .where(eq(communityVoteSchema.id, existing.id));
        newScore -= existing.value;
      }
      viewerVote = 0;
    } else if (!existing) {
      await db.insert(communityVoteSchema).values({
        postId,
        userId,
        value,
      });
      newScore += value;
      viewerVote = value as VoteValue;
    } else if (existing.value !== value) {
      await db
        .update(communityVoteSchema)
        .set({ value })
        .where(eq(communityVoteSchema.id, existing.id));
      newScore += value - existing.value;
      viewerVote = value as VoteValue;
    } else {
      viewerVote = existing.value as VoteValue;
    }

    await db
      .update(communityPostSchema)
      .set({ score: newScore })
      .where(eq(communityPostSchema.id, postId));

    logger.info({ postId, userId, value }, 'Community post voted');

    return { score: newScore, viewerVote };
  }

  async createComment(
    authorId: string,
    input: CreateCommunityCommentInput,
  ): Promise<CommunityComment | null> {
    const post = await this.getPostWithComments(null, input.postId);
    if (!post) {
      return null;
    }

    const [created] = await db
      .insert(communityCommentSchema)
      .values({
        postId: input.postId,
        authorId,
        parentCommentId: input.parentCommentId ?? null,
        body: input.body,
        isAnonymous: input.isAnonymous,
      })
      .returning();

    if (!created) {
      throw new Error('FAILED_TO_CREATE_COMMENT');
    }

    logger.info(
      { postId: input.postId, authorId, parentCommentId: input.parentCommentId },
      'Community comment created',
    );

    const [user] = await db
      .select()
      .from(userSchema)
      .where(eq(userSchema.id, authorId))
      .limit(1);

    const author = mapAuthorPublic(user, created.isAnonymous);

    return {
      id: created.id,
      postId: created.postId,
      parentCommentId: created.parentCommentId ?? null,
      body: created.body,
      createdAt: created.createdAt.toISOString(),
      author,
    } satisfies CommunityComment;
  }

  async createReport(
    reporterId: string,
    input: CreateCommunityReportInput,
  ): Promise<void> {
    await db.insert(communityReportSchema).values({
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
      reporterId,
      reason: input.reason,
      details: input.details ?? null,
      status: 'OPEN',
    });

    logger.info(
      {
        reporterId,
        postId: input.postId,
        commentId: input.commentId,
      },
      'Community report created',
    );
  }
}

export const communityService = new CommunityService();
