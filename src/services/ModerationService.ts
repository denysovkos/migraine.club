import type { ReportStatusType, UserRoleType } from '@/models/Schema';

import type {
  CommunityAuthorPublic,
  CommunityReportSummary,
  HiddenContentItem,
  ResolveReportInput,
  UpdateContentVisibilityInput,
  UpdateUserRoleInput,
  UserSummary,
} from '@/types/Community';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  communityCommentSchema,
  communityPostSchema,
  communityReportSchema,

  userSchema,
} from '@/models/Schema';

type DbUser = typeof userSchema.$inferSelect;

function mapAuthorPublic(
  user: DbUser | undefined | null,
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

  return {
    displayName: user.communityHandle ?? null,
    // Feature F13: verified badge is driven by user.role, not client-controlled flags.
    isDoctor: user.role === 'doctor_pending'
      || user.role === 'doctor_verified'
      || user.role === 'doctor_rejected',
    isDoctorVerified: user.role === 'doctor_verified',
    doctorSpecialty: null,
    isAnonymous: false,
  };
}

export class ModerationService {
  /**
   * Check if a user has moderator or admin role
   */
  async getUserRole(userId: string): Promise<UserRoleType | null> {
    const [user] = await db
      .select({ role: userSchema.role })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1);

    return user?.role ?? null;
  }

  /**
   * Check if user is moderator or admin
   */
  async isModerator(userId: string): Promise<boolean> {
    const role = await this.getUserRole(userId);
    return role === 'moderator' || role === 'admin';
  }

  /**
   * Check if user is admin
   */
  async isAdmin(userId: string): Promise<boolean> {
    const role = await this.getUserRole(userId);
    return role === 'admin';
  }

  /**
   * Get open reports for moderation dashboard
   */
  async getOpenReports(limit = 50): Promise<CommunityReportSummary[]> {
    const reports = await db
      .select({
        id: communityReportSchema.id,
        postId: communityReportSchema.postId,
        commentId: communityReportSchema.commentId,
        reason: communityReportSchema.reason,
        details: communityReportSchema.details,
        status: communityReportSchema.status,
        createdAt: communityReportSchema.createdAt,
      })
      .from(communityReportSchema)
      .where(eq(communityReportSchema.status, 'OPEN'))
      .orderBy(desc(communityReportSchema.createdAt))
      .limit(limit);

    const results: CommunityReportSummary[] = [];

    for (const report of reports) {
      let contentSnippet = '';
      let contentType: 'post' | 'comment' = 'post';
      let contentAuthor: CommunityAuthorPublic = {
        displayName: null,
        isDoctor: false,
        isDoctorVerified: false,
        isAnonymous: true,
      };

      if (report.postId) {
        const [post] = await db
          .select({
            title: communityPostSchema.title,
            body: communityPostSchema.body,
            isAnonymous: communityPostSchema.isAnonymous,
            authorId: communityPostSchema.authorId,
          })
          .from(communityPostSchema)
          .where(eq(communityPostSchema.id, report.postId))
          .limit(1);

        if (post) {
          contentSnippet = `${post.title}: ${post.body.slice(0, 100)}${post.body.length > 100 ? '…' : ''}`;
          contentType = 'post';

          const [author] = await db
            .select()
            .from(userSchema)
            .where(eq(userSchema.id, post.authorId))
            .limit(1);

          contentAuthor = mapAuthorPublic(author, post.isAnonymous);
        }
      } else if (report.commentId) {
        const [comment] = await db
          .select({
            body: communityCommentSchema.body,
            isAnonymous: communityCommentSchema.isAnonymous,
            authorId: communityCommentSchema.authorId,
          })
          .from(communityCommentSchema)
          .where(eq(communityCommentSchema.id, report.commentId))
          .limit(1);

        if (comment) {
          contentSnippet = comment.body.slice(0, 150) + (comment.body.length > 150 ? '…' : '');
          contentType = 'comment';

          const [author] = await db
            .select()
            .from(userSchema)
            .where(eq(userSchema.id, comment.authorId))
            .limit(1);

          contentAuthor = mapAuthorPublic(author, comment.isAnonymous);
        }
      }

      results.push({
        id: report.id,
        postId: report.postId,
        commentId: report.commentId,
        reason: report.reason,
        details: report.details,
        status: report.status,
        createdAt: report.createdAt.toISOString(),
        contentSnippet,
        contentType,
        contentAuthor,
      });
    }

    return results;
  }

  /**
   * Get count of open reports for a post or comment
   */
  async getReportCount(postId?: string, commentId?: string): Promise<number> {
    const condition = postId
      ? eq(communityReportSchema.postId, postId)
      : commentId
        ? eq(communityReportSchema.commentId, commentId)
        : null;

    if (!condition) {
      return 0;
    }

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(communityReportSchema)
      .where(and(condition, eq(communityReportSchema.status, 'OPEN')));

    return Number(result?.count) || 0;
  }

  /**
   * Resolve a report
   */
  async resolveReport(
    moderatorId: string,
    input: ResolveReportInput,
  ): Promise<boolean> {
    const [updated] = await db
      .update(communityReportSchema)
      .set({
        status: input.status as ReportStatusType,
        resolvedBy: moderatorId,
        resolvedAt: new Date(),
      })
      .where(eq(communityReportSchema.id, input.reportId))
      .returning({ id: communityReportSchema.id });

    if (updated) {
      logger.info(
        { reportId: input.reportId, moderatorId, status: input.status },
        'Report resolved',
      );
      return true;
    }

    return false;
  }

  /**
   * Update visibility of a post or comment (hide/unhide)
   */
  async updateContentVisibility(
    moderatorId: string,
    input: UpdateContentVisibilityInput,
  ): Promise<boolean> {
    if (input.postId) {
      const [updated] = await db
        .update(communityPostSchema)
        .set({ visibility: input.visibility })
        .where(eq(communityPostSchema.id, input.postId))
        .returning({ id: communityPostSchema.id });

      if (updated) {
        logger.info(
          { postId: input.postId, moderatorId, visibility: input.visibility },
          'Post visibility updated',
        );
        return true;
      }
    } else if (input.commentId) {
      const [updated] = await db
        .update(communityCommentSchema)
        .set({ visibility: input.visibility })
        .where(eq(communityCommentSchema.id, input.commentId))
        .returning({ id: communityCommentSchema.id });

      if (updated) {
        logger.info(
          { commentId: input.commentId, moderatorId, visibility: input.visibility },
          'Comment visibility updated',
        );
        return true;
      }
    }

    return false;
  }

  /**
   * Get recently hidden posts and comments
   */
  async getHiddenContent(limit = 50): Promise<HiddenContentItem[]> {
    const results: HiddenContentItem[] = [];

    // Get hidden posts
    const hiddenPosts = await db
      .select({
        id: communityPostSchema.id,
        title: communityPostSchema.title,
        body: communityPostSchema.body,
        isAnonymous: communityPostSchema.isAnonymous,
        updatedAt: communityPostSchema.updatedAt,
        authorId: communityPostSchema.authorId,
      })
      .from(communityPostSchema)
      .where(eq(communityPostSchema.visibility, 'HIDDEN'))
      .orderBy(desc(communityPostSchema.updatedAt))
      .limit(limit);

    for (const post of hiddenPosts) {
      const [author] = await db
        .select()
        .from(userSchema)
        .where(eq(userSchema.id, post.authorId))
        .limit(1);

      results.push({
        id: post.id,
        type: 'post',
        title: post.title,
        bodySnippet: post.body.slice(0, 100) + (post.body.length > 100 ? '…' : ''),
        author: mapAuthorPublic(author, post.isAnonymous),
        hiddenAt: post.updatedAt.toISOString(),
      });
    }

    // Get hidden comments
    const hiddenComments = await db
      .select({
        id: communityCommentSchema.id,
        body: communityCommentSchema.body,
        isAnonymous: communityCommentSchema.isAnonymous,
        updatedAt: communityCommentSchema.updatedAt,
        authorId: communityCommentSchema.authorId,
        postId: communityCommentSchema.postId,
      })
      .from(communityCommentSchema)
      .where(eq(communityCommentSchema.visibility, 'HIDDEN'))
      .orderBy(desc(communityCommentSchema.updatedAt))
      .limit(limit);

    for (const comment of hiddenComments) {
      const [author] = await db
        .select()
        .from(userSchema)
        .where(eq(userSchema.id, comment.authorId))
        .limit(1);

      results.push({
        id: comment.id,
        type: 'comment',
        bodySnippet: comment.body.slice(0, 150) + (comment.body.length > 150 ? '…' : ''),
        author: mapAuthorPublic(author, comment.isAnonymous),
        hiddenAt: comment.updatedAt.toISOString(),
        postId: comment.postId,
      });
    }

    // Sort by hiddenAt date
    results.sort((a, b) =>
      new Date(b.hiddenAt).getTime() - new Date(a.hiddenAt).getTime(),
    );

    return results.slice(0, limit);
  }

  /**
   * Update user role (admin only)
   */
  async updateUserRole(
    adminId: string,
    input: UpdateUserRoleInput,
  ): Promise<boolean> {
    const [updated] = await db
      .update(userSchema)
      .set({ role: input.role })
      .where(eq(userSchema.id, input.userId))
      .returning({ id: userSchema.id });

    if (updated) {
      logger.info(
        { userId: input.userId, adminId, newRole: input.role },
        'User role updated',
      );
      return true;
    }

    return false;
  }

  /**
   * Get users for role management
   */
  async getUsers(search?: string, limit = 50): Promise<UserSummary[]> {
    const query = search
      ? db
          .select({
            id: userSchema.id,
            communityHandle: userSchema.communityHandle,
            role: userSchema.role,
            isDoctor: userSchema.isDoctor,
            isDoctorVerified: userSchema.isDoctorVerified,
            createdAt: userSchema.createdAt,
          })
          .from(userSchema)
          .where(
            or(
              sql`${userSchema.communityHandle} ILIKE ${`%${search}%`}`,
              sql`${userSchema.id} ILIKE ${`%${search}%`}`,
            ),
          )
          .orderBy(desc(userSchema.createdAt))
          .limit(limit)
      : db
          .select({
            id: userSchema.id,
            communityHandle: userSchema.communityHandle,
            role: userSchema.role,
            isDoctor: userSchema.isDoctor,
            isDoctorVerified: userSchema.isDoctorVerified,
            createdAt: userSchema.createdAt,
          })
          .from(userSchema)
          .orderBy(desc(userSchema.createdAt))
          .limit(limit);

    const users = await query;

    return users.map(user => ({
      id: user.id,
      communityHandle: user.communityHandle,
      role: user.role,
      isDoctor: user.isDoctor,
      isDoctorVerified: user.isDoctorVerified,
      createdAt: user.createdAt.toISOString(),
    }));
  }

  /**
   * Get reports for a specific post or comment
   */
  async getReportsForContent(
    postId?: string,
    commentId?: string,
  ): Promise<CommunityReportSummary[]> {
    const condition = postId
      ? eq(communityReportSchema.postId, postId)
      : commentId
        ? eq(communityReportSchema.commentId, commentId)
        : null;

    if (!condition) {
      return [];
    }

    const reports = await db
      .select({
        id: communityReportSchema.id,
        postId: communityReportSchema.postId,
        commentId: communityReportSchema.commentId,
        reason: communityReportSchema.reason,
        details: communityReportSchema.details,
        status: communityReportSchema.status,
        createdAt: communityReportSchema.createdAt,
      })
      .from(communityReportSchema)
      .where(condition)
      .orderBy(desc(communityReportSchema.createdAt));

    return reports.map(report => ({
      id: report.id,
      postId: report.postId,
      commentId: report.commentId,
      reason: report.reason,
      details: report.details,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      contentSnippet: '',
      contentType: report.postId ? 'post' : 'comment',
      contentAuthor: {
        displayName: null,
        isDoctor: false,
        isDoctorVerified: false,
        isAnonymous: true,
      },
    }));
  }
}

export const moderationService = new ModerationService();
