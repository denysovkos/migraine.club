import { auth } from '@clerk/nextjs/server';
import { and, count, eq, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { communityPostSchema } from '@/models/Schema';

type CommunityStatsResponse = {
  postsToday: number;
  activeUsersThisWeek: number;
  topTagThisWeek: string | null;
  trendingTags: Array<{ tag: string; count: number }>;
};

// GET /api/community/stats - get community stats and trending tags
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Calculate date boundaries
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Posts today count
    const [postsTodayResult] = await db
      .select({ count: count() })
      .from(communityPostSchema)
      .where(
        and(
          eq(communityPostSchema.visibility, 'PUBLIC'),
          gte(communityPostSchema.createdAt, startOfToday),
        ),
      );

    const postsToday = postsTodayResult?.count ?? 0;

    // Active users this week (distinct authors)
    const activeUsersResult = await db
      .selectDistinct({ authorId: communityPostSchema.authorId })
      .from(communityPostSchema)
      .where(
        and(
          eq(communityPostSchema.visibility, 'PUBLIC'),
          gte(communityPostSchema.createdAt, oneWeekAgo),
        ),
      );

    const activeUsersThisWeek = activeUsersResult.length;

    // Get posts from last week to extract tag trends
    const recentPosts = await db
      .select({
        tags: communityPostSchema.tags,
      })
      .from(communityPostSchema)
      .where(
        and(
          eq(communityPostSchema.visibility, 'PUBLIC'),
          gte(communityPostSchema.createdAt, oneWeekAgo),
        ),
      );

    // Count tag occurrences
    const tagCounts: Record<string, number> = {};
    for (const post of recentPosts) {
      if (post.tags) {
        const tags = post.tags.split(',').map(t => t.trim()).filter(Boolean);
        for (const tag of tags) {
          tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
        }
      }
    }

    // Sort tags by count and get top 5
    const sortedTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag, tagCount]) => ({ tag, count: tagCount }));

    const topTagThisWeek = sortedTags[0]?.tag ?? null;

    const stats: CommunityStatsResponse = {
      postsToday,
      activeUsersThisWeek,
      topTagThisWeek,
      trendingTags: sortedTags,
    };

    return NextResponse.json(stats);
  } catch (error) {
    logger.error({ error }, 'Error fetching community stats');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
