'use client';

import type {
  CommunityPostDetail,
  CommunityPostSummary,
  CreateCommunityCommentInput,
  CreateCommunityPostInput,
  VoteValue,
} from '@/types/Community';

import { useCallback, useEffect, useState } from 'react';

// Types for API responses
type ListPostsResponse = {
  posts: CommunityPostSummary[];
};

type CommunityStats = {
  postsToday: number;
  activeUsersThisWeek: number;
  topTagThisWeek: string | null;
  trendingTags: Array<{ tag: string; count: number }>;
};

type UserSharedEpisode = {
  postId: string;
  episodeDate: string;
  title: string;
  commentCount: number;
  score: number;
};

// Hook for community feed
export function useCommunityFeed(options?: {
  sort?: 'new' | 'top';
  tag?: string;
  page?: number;
  limit?: number;
  selectedOnlyOwn?: boolean;
}) {
  const [posts, setPosts] = useState<CommunityPostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (options?.sort) {
        params.set('sort', options.sort);
      }
      if (options?.tag) {
        params.set('tag', options.tag);
      }
      if (options?.page) {
        params.set('page', options.page.toString());
      }
      if (options?.limit) {
        params.set('limit', options.limit.toString());
      }
      if (options?.selectedOnlyOwn) {
        params.set('onlyOwn', 'true');
      }

      const response = await fetch(`/api/community/posts?${params}`);

      if (!response.ok) {
        throw new Error('Failed to load posts');
      }

      const data: ListPostsResponse = await response.json();
      setPosts(data.posts);
      setHasMore(data.posts.length === (options?.limit ?? 10));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  }, [options?.sort, options?.tag, options?.page, options?.limit, options?.selectedOnlyOwn]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  return { posts, loading, error, hasMore, refetch: fetchPosts };
}

// Hook for single post detail
export function useCommunityPost(postId: string | null) {
  const [post, setPost] = useState<CommunityPostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPost = useCallback(async () => {
    if (!postId) {
      setPost(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/community/posts/${postId}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Post not found');
        }
        throw new Error('Failed to load post');
      }

      const data: CommunityPostDetail = await response.json();
      setPost(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load post');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  return { post, loading, error, refetch: fetchPost };
}

// Hook for creating posts
export function useCreateCommunityPost() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createPost = useCallback(async (input: CreateCommunityPostInput) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create post');
      }

      const post: CommunityPostDetail = await response.json();
      return post;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create post';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { createPost, loading, error };
}

// Hook for voting
export function useVoteOnPost() {
  const [loading, setLoading] = useState(false);

  const vote = useCallback(async (postId: string, value: VoteValue) => {
    setLoading(true);

    try {
      const response = await fetch(`/api/community/posts/${postId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });

      if (!response.ok) {
        throw new Error('Failed to vote');
      }

      const result: { score: number; viewerVote: VoteValue } = await response.json();
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  return { vote, loading };
}

// Hook for creating comments
export function useCreateComment() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createComment = useCallback(async (input: CreateCommunityCommentInput) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/community/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create comment');
      }

      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create comment';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { createComment, loading, error };
}

// Hook for community stats
export function useCommunityStats() {
  const [stats, setStats] = useState<CommunityStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/community/stats');
        if (response.ok) {
          const data: CommunityStats = await response.json();
          setStats(data);
        } else {
          // Fallback to mock data if API fails
          setStats({
            postsToday: 0,
            activeUsersThisWeek: 0,
            topTagThisWeek: null,
            trendingTags: [],
          });
        }
      } catch {
        // Fallback to mock data on error
        setStats({
          postsToday: 0,
          activeUsersThisWeek: 0,
          topTagThisWeek: null,
          trendingTags: [],
        });
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  return { stats, loading };
}

// Hook for user's shared episodes
export function useMySharedEpisodes() {
  const [episodes, setEpisodes] = useState<UserSharedEpisode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMyPosts() {
      try {
        // Fetch posts with sort=new to get user's recent posts
        // In a real implementation, we'd have a dedicated endpoint for this
        const response = await fetch('/api/community/posts?limit=5&sort=new');
        if (response.ok) {
          const data: ListPostsResponse = await response.json();
          // Filter to only posts that are from episodes and belong to current user
          const myEpisodePosts = data.posts
            .filter(p => p.isFromEpisode && p.isMine)
            .slice(0, 5)
            .map(p => ({
              postId: p.id,
              episodeDate: p.createdAt,
              title: p.title,
              commentCount: p.commentCount,
              score: p.score,
            }));
          setEpisodes(myEpisodePosts);
        }
      } catch {
        // Silent fail for optional feature
      } finally {
        setLoading(false);
      }
    }

    fetchMyPosts();
  }, []);

  return { episodes, loading };
}

// Hook to check if an episode has been shared
export function useEpisodeSharedStatus(episodeId: number | null) {
  const [sharedPostId, setSharedPostId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!episodeId) {
      setLoading(false);
      return;
    }

    async function checkShared() {
      try {
        // In a real implementation, we'd have an endpoint to check this
        // For now, we'll search through recent posts
        const response = await fetch('/api/community/posts?limit=50&sort=new');
        if (response.ok) {
          const data: ListPostsResponse = await response.json();
          const sharedPost = data.posts.find(
            p => p.isFromEpisode && p.episodeId === episodeId && p.isMine,
          );
          setSharedPostId(sharedPost?.id ?? null);
        }
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    }

    checkShared();
  }, [episodeId]);

  return { sharedPostId, isShared: !!sharedPostId, loading };
}

// Hook for reporting content
export function useReportContent() {
  const [loading, setLoading] = useState(false);

  const report = useCallback(async (params: {
    postId?: string;
    commentId?: string;
    reason: string;
    details?: string;
  }) => {
    setLoading(true);

    try {
      const response = await fetch('/api/community/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error('Failed to submit report');
      }

      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { report, loading };
}
