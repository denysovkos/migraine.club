import type { CommunityPostSummary } from '@/types/Community';
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunityPostCard } from './CommunityPostCard';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const messages = {
  Community: {
    anonymous_author: 'Anonymous',
    verified_doctor_tooltip: 'Verified medical professional',
    from_diary_badge: 'From diary',
    replies_count: '{count} replies',
    no_replies: 'No replies yet',
    read_more: 'Read more',
    report_button: 'Report',
  },
  Moderation: {
    hidden_indicator: 'Hidden',
    hide_post: 'Hide post',
    unhide_post: 'Unhide post',
  },
};

const mockPost: CommunityPostSummary = {
  id: 'test-id',
  title: 'Test Post Title',
  bodyPreview: 'This is a test post body preview.',
  score: 5,
  tags: ['Trigger', 'Weather'],
  isFromEpisode: false,
  episodeId: null,
  createdAt: new Date().toISOString(),
  author: {
    displayName: 'TestUser',
    isDoctor: false,
    isDoctorVerified: false,
    isAnonymous: false,
  },
  viewerVote: 0,
  commentCount: 3,
  isMine: false,
};

const renderWithIntl = async (component: React.ReactNode) => {
  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {component}
    </NextIntlClientProvider>,
  );
  // Flush the useUserRole fetch + setState that fires on mount.
  await act(async () => {});
  return result;
};

describe('CommunityPostCard', () => {
  beforeEach(() => {
    // useUserRole() calls /api/moderation/role on mount
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ role: 'user', isModerator: false, isAdmin: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as any;
  });

  it('renders post title', async () => {
    await renderWithIntl(<CommunityPostCard post={mockPost} />);

    expect(screen.getByText('Test Post Title')).toBeInTheDocument();
  });

  it('renders post body preview', async () => {
    await renderWithIntl(<CommunityPostCard post={mockPost} />);

    expect(screen.getByText('This is a test post body preview.')).toBeInTheDocument();
  });

  it('renders score', async () => {
    await renderWithIntl(<CommunityPostCard post={mockPost} />);

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders tags', async () => {
    await renderWithIntl(<CommunityPostCard post={mockPost} />);

    expect(screen.getByText('Trigger')).toBeInTheDocument();
    expect(screen.getByText('Weather')).toBeInTheDocument();
  });

  it('renders author name when not anonymous', async () => {
    await renderWithIntl(<CommunityPostCard post={mockPost} />);

    expect(screen.getByText('TestUser')).toBeInTheDocument();
  });

  it('renders anonymous label when author is anonymous', async () => {
    const anonymousPost = {
      ...mockPost,
      author: {
        ...mockPost.author,
        isAnonymous: true,
        displayName: null,
      },
    };
    await renderWithIntl(<CommunityPostCard post={anonymousPost} />);

    expect(screen.getByText('Anonymous')).toBeInTheDocument();
  });

  it('shows from diary badge when post is from episode', async () => {
    const episodePost = {
      ...mockPost,
      isFromEpisode: true,
      episodeId: 123,
    };
    await renderWithIntl(<CommunityPostCard post={episodePost} />);

    expect(screen.getByText('From diary')).toBeInTheDocument();
  });

  it('renders comment count', async () => {
    await renderWithIntl(<CommunityPostCard post={mockPost} />);

    expect(screen.getByText('3 replies')).toBeInTheDocument();
  });
});
