'use client';

import type { CommunityPostSummary, VoteValue } from '@/types/Community';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Flag,
  MessageCircle,
  MoreHorizontal,
  Stethoscope,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useVoteOnPost } from '@/hooks/useCommunity';
import { useUpdateVisibility, useUserRole } from '@/hooks/useModeration';
import { cn } from '@/utils/Helpers';

import { ReportModal } from './ReportModal';

type CommunityPostCardProps = {
  post: CommunityPostSummary;
  onVoteChange?: (postId: string, newScore: number, newVote: VoteValue) => void;
  onVisibilityChange?: (postId: string) => void;
};

export function CommunityPostCard({ post, onVoteChange, onVisibilityChange }: CommunityPostCardProps) {
  const t = useTranslations('Community');
  const tMod = useTranslations('Moderation');
  const { vote, loading: voteLoading } = useVoteOnPost();
  const { isModerator } = useUserRole();
  const { updateVisibility, loading: visibilityLoading } = useUpdateVisibility();
  const [localScore, setLocalScore] = useState(post.score);
  const [localVote, setLocalVote] = useState<VoteValue>(post.viewerVote);
  const [showReportModal, setShowReportModal] = useState(false);
  const [localVisibility, setLocalVisibility] = useState(post.visibility);

  const isHidden = localVisibility === 'HIDDEN';

  const specialtyLabel = (specialty?: string | null) => {
    switch (specialty) {
      case 'neurologist':
        return t('doctor_specialty_neurologist');
      case 'gp':
        return t('doctor_specialty_gp');
      case 'pain_specialist':
        return t('doctor_specialty_pain_specialist');
      case 'other':
        return t('doctor_specialty_other');
      default:
        return null;
    }
  };

  const handleVote = async (value: VoteValue) => {
    if (voteLoading) {
      return;
    }

    // Optimistic update
    const newVote: VoteValue = localVote === value ? 0 : value;
    const scoreDiff = newVote - localVote;
    const newScore = localScore + scoreDiff;

    setLocalVote(newVote);
    setLocalScore(newScore);

    try {
      const result = await vote(post.id, newVote);
      if (result) {
        setLocalScore(result.score);
        setLocalVote(result.viewerVote);
        onVoteChange?.(post.id, result.score, result.viewerVote);
      }
    } catch {
      // Revert on error
      setLocalVote(post.viewerVote);
      setLocalScore(post.score);
    }
  };

  const handleToggleVisibility = async () => {
    if (visibilityLoading) {
      return;
    }

    const newVisibility = isHidden ? 'PUBLIC' : 'HIDDEN';
    setLocalVisibility(newVisibility);

    const success = await updateVisibility({
      postId: post.id,
      visibility: newVisibility,
    });

    if (success) {
      onVisibilityChange?.(post.id);
    } else {
      // Revert on error
      setLocalVisibility(post.visibility);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    // Use Math.max to handle clock skew (server time ahead of client)
    const diffMs = Math.max(0, now.getTime() - date.getTime());
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) {
      return 'Just now';
    }
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return date.toLocaleDateString();
  };

  return (
    <>
      <article className={cn(
        'group rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md',
        isHidden && 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20',
      )}
      >
        <div className="flex gap-3">
          {/* Voting controls */}
          <div className="flex flex-col items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'size-8 p-0 hover:bg-primary/10 hover:text-primary',
                localVote === 1 && 'text-primary',
              )}
              onClick={() => handleVote(1)}
              disabled={voteLoading}
              aria-label="Upvote"
            >
              <ChevronUp className="size-5" />
            </Button>
            <span className={cn(
              'text-sm font-medium tabular-nums',
              localScore > 0 && 'text-primary',
              localScore < 0 && 'text-destructive',
            )}
            >
              {localScore}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'size-8 p-0 hover:bg-destructive/10 hover:text-destructive',
                localVote === -1 && 'text-destructive',
              )}
              onClick={() => handleVote(-1)}
              disabled={voteLoading}
              aria-label="Downvote"
            >
              <ChevronDown className="size-5" />
            </Button>
          </div>

          {/* Post content */}
          <div className="min-w-0 flex-1">
            {/* Hidden badge and moderation menu */}
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {isHidden && (
                  <Badge variant="outline" className="border-amber-500 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                    <EyeOff className="mr-1 size-3" />
                    {tMod('hidden_indicator')}
                  </Badge>
                )}
                {isModerator && (post.reportCount ?? 0) > 0 && (
                  <Badge variant="outline" className="border-red-500 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    <AlertTriangle className="mr-1 size-3" />
                    {tMod('reports_count', { count: post.reportCount ?? 0 })}
                  </Badge>
                )}
              </div>

              {/* Actions menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="size-8 p-0">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* Report option for all users */}
                  <DropdownMenuItem onClick={() => setShowReportModal(true)}>
                    <Flag className="mr-2 size-4" />
                    {t('report_button')}
                  </DropdownMenuItem>

                  {/* Moderation options */}
                  {isModerator && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleToggleVisibility}
                        disabled={visibilityLoading}
                      >
                        {isHidden
                          ? (
                              <>
                                <Eye className="mr-2 size-4" />
                                {tMod('unhide_post')}
                              </>
                            )
                          : (
                              <>
                                <EyeOff className="mr-2 size-4" />
                                {tMod('hide_post')}
                              </>
                            )}
                      </DropdownMenuItem>
                      {(post.reportCount ?? 0) > 0 && (
                        <DropdownMenuItem asChild>
                          <Link href={`/dashboard/moderation?postId=${post.id}`}>
                            <AlertTriangle className="mr-2 size-4" />
                            {tMod('view_reports', { count: post.reportCount ?? 0 })}
                          </Link>
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Title */}
            <Link
              href={`/dashboard/community/${post.id}`}
              className="block"
            >
              <h3 className="mb-1 text-base font-semibold leading-snug text-foreground group-hover:text-primary">
                {post.title}
              </h3>
            </Link>

            {/* Body preview */}
            <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
              {post.bodyPreview}
              {post.bodyPreview.endsWith('…') && (
                <Link
                  href={`/dashboard/community/${post.id}`}
                  className="ml-1 text-primary hover:underline"
                >
                  {t('read_more')}
                </Link>
              )}
            </p>

            {/* Tags */}
            {post.tags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {post.tags.slice(0, 4).map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
                {post.tags.length > 4 && (
                  <Badge variant="secondary" className="text-xs">
                    +
                    {post.tags.length - 4}
                  </Badge>
                )}
              </div>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {/* Author */}
              <span className="flex items-center gap-1">
                {post.author.isAnonymous
                  ? (
                      <span className="font-medium">{t('anonymous_author')}</span>
                    )
                  : (
                      <>
                        <span className="font-medium">{post.author.displayName}</span>
                        {post.author.isDoctorVerified && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                                  <Stethoscope className="size-3" />
                                  <span className="hidden sm:inline">{t('verified_doctor_badge')}</span>
                                  {post.author.doctorSpecialty && (
                                    <span className="hidden sm:inline">
                                      •
                                      {' '}
                                      {specialtyLabel(post.author.doctorSpecialty)}
                                    </span>
                                  )}
                                  <span className="sr-only">
                                    {t('verified_doctor_badge')}
                                    {post.author.doctorSpecialty
                                      ? ` (${specialtyLabel(post.author.doctorSpecialty)})`
                                      : ''}
                                  </span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t('verified_doctor_tooltip')}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </>
                    )}
              </span>

              <span>•</span>

              {/* Date */}
              <span>{formatDate(post.createdAt)}</span>

              {/* From diary badge */}
              {post.isFromEpisode && (
                <>
                  <span>•</span>
                  <Badge variant="outline" className="text-xs">
                    {t('from_diary_badge')}
                  </Badge>
                </>
              )}

              <span>•</span>

              {/* Comment count */}
              <Link
                href={`/dashboard/community/${post.id}`}
                className="flex items-center gap-1 hover:text-primary"
              >
                <MessageCircle className="size-3.5" />
                <span>
                  {post.commentCount > 0
                    ? t('replies_count', { count: post.commentCount })
                    : t('no_replies')}
                </span>
              </Link>
            </div>
          </div>
        </div>
      </article>

      {/* Report modal */}
      {showReportModal && (
        <ReportModal
          postId={post.id}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </>
  );
}
