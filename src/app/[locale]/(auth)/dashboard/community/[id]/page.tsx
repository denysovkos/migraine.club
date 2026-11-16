'use client';

import type { CommunityComment, CommunityVisibilityType, VoteValue } from '@/types/Community';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Flag,
  MessageCircle,
  MoreHorizontal,
  Reply,
  Stethoscope,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

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
import { ReportModal } from '@/features/community/ReportModal';
import { TitleBar } from '@/features/dashboard/TitleBar';
import {
  useCommunityPost,
  useCreateComment,
  useVoteOnPost,
} from '@/hooks/useCommunity';
import { useUpdateVisibility, useUserRole } from '@/hooks/useModeration';
import { cn } from '@/utils/Helpers';

function specialtyLabel(specialty?: string | null) {
  switch (specialty) {
    case 'neurologist':
      return 'Neurologist';
    case 'gp':
      return 'GP';
    case 'pain_specialist':
      return 'Pain Specialist';
    case 'other':
      return 'Other';
    default:
      return null;
  }
}

export default function CommunityPostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('Community');
  const tMod = useTranslations('Moderation');
  const postId = params.id as string;

  const { post, loading, error, refetch } = useCommunityPost(postId);
  const { vote, loading: voteLoading } = useVoteOnPost();
  const { createComment, loading: commentLoading } = useCreateComment();
  const { isModerator } = useUserRole();
  const { updateVisibility, loading: visibilityLoading } = useUpdateVisibility();

  const [localScore, setLocalScore] = useState<number | null>(null);
  const [localVote, setLocalVote] = useState<VoteValue | null>(null);
  const [localVisibility, setLocalVisibility] = useState<CommunityVisibilityType | undefined>(undefined);
  const [commentBody, setCommentBody] = useState('');
  const [commentAnonymous, setCommentAnonymous] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState<{
    type: 'post' | 'comment';
    id: string;
  } | null>(null);

  const currentScore = localScore ?? post?.score ?? 0;
  const currentVote = localVote ?? post?.viewerVote ?? 0;
  const currentVisibility = localVisibility ?? post?.visibility;
  const isHidden = currentVisibility === 'HIDDEN';

  const handleVote = async (value: VoteValue) => {
    if (voteLoading || !post) {
      return;
    }

    const newVote: VoteValue = currentVote === value ? 0 : value;
    const scoreDiff = newVote - currentVote;

    setLocalVote(newVote);
    setLocalScore(currentScore + scoreDiff);

    try {
      const result = await vote(post.id, newVote);
      if (result) {
        setLocalScore(result.score);
        setLocalVote(result.viewerVote);
      }
    } catch {
      setLocalVote(null);
      setLocalScore(null);
    }
  };

  const handleTogglePostVisibility = async () => {
    if (visibilityLoading || !post) {
      return;
    }

    const newVisibility = isHidden ? 'PUBLIC' : 'HIDDEN';
    setLocalVisibility(newVisibility);

    const success = await updateVisibility({
      postId: post.id,
      visibility: newVisibility,
    });

    if (!success) {
      setLocalVisibility(post.visibility);
    }
  };

  const handleToggleCommentVisibility = async (
    commentId: string,
    currentCommentVisibility: CommunityVisibilityType | undefined,
  ) => {
    if (visibilityLoading) {
      return;
    }

    const newVisibility = currentCommentVisibility === 'HIDDEN' ? 'PUBLIC' : 'HIDDEN';
    const success = await updateVisibility({
      commentId,
      visibility: newVisibility,
    });

    if (success) {
      refetch();
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!post || !commentBody.trim()) {
      return;
    }

    try {
      await createComment({
        postId: post.id,
        body: commentBody.trim(),
        isAnonymous: commentAnonymous,
        parentCommentId: replyingTo ?? undefined,
      });
      setCommentBody('');
      setReplyingTo(null);
      refetch();
    } catch {
      // Error handled by hook
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <>
        <TitleBar title={t('post_detail_title')} />
        <div className="space-y-4">
          <div className="h-48 animate-pulse rounded-xl bg-muted" />
          <div className="h-32 animate-pulse rounded-xl bg-muted" />
        </div>
      </>
    );
  }

  if (error || !post) {
    return (
      <>
        <TitleBar title={t('post_detail_title')} />
        <div className="rounded-xl border bg-destructive/10 p-6 text-center">
          <p className="text-sm text-destructive">{error || 'Post not found'}</p>
          <Button size="sm" className="mt-3" onClick={() => router.push('/dashboard/community')}>
            Back to feed
          </Button>
        </div>
      </>
    );
  }

  // Group comments by parent
  const rootComments = post.comments.filter(c => !c.parentCommentId);
  const repliesByParent = post.comments.reduce<Record<string, CommunityComment[]>>(
    (acc, c) => {
      if (c.parentCommentId) {
        if (!acc[c.parentCommentId]) {
          acc[c.parentCommentId] = [];
        }
        acc[c.parentCommentId]!.push(c);
      }
      return acc;
    },
    {},
  );

  return (
    <>
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/community">
            <ArrowLeft className="mr-1.5 size-4" />
            Back to feed
          </Link>
        </Button>
      </div>

      <article className="space-y-6">
        {/* Post content */}
        <div className={cn(
          'rounded-xl border bg-card p-5 shadow-sm',
          isHidden && 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20',
        )}
        >
          <div className="flex gap-4">
            {/* Voting */}
            <div className="flex flex-col items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'size-9 p-0 hover:bg-primary/10 hover:text-primary',
                  currentVote === 1 && 'text-primary',
                )}
                onClick={() => handleVote(1)}
                disabled={voteLoading}
              >
                <ChevronUp className="size-6" />
              </Button>
              <span className={cn(
                'text-lg font-semibold tabular-nums',
                currentScore > 0 && 'text-primary',
                currentScore < 0 && 'text-destructive',
              )}
              >
                {currentScore}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'size-9 p-0 hover:bg-destructive/10 hover:text-destructive',
                  currentVote === -1 && 'text-destructive',
                )}
                onClick={() => handleVote(-1)}
                disabled={voteLoading}
              >
                <ChevronDown className="size-6" />
              </Button>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              {/* Header with badges and actions */}
              <div className="mb-2 flex items-start justify-between gap-2">
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
                    <DropdownMenuItem onClick={() => setShowReportModal({ type: 'post', id: post.id })}>
                      <Flag className="mr-2 size-4" />
                      {t('report_button')}
                    </DropdownMenuItem>

                    {isModerator && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={handleTogglePostVisibility}
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

              <h1 className="mb-2 text-xl font-bold">{post.title}</h1>

              {/* Episode badge */}
              {post.isFromEpisode && (
                <div className="mb-3 flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    <BookOpen className="mr-1 size-3" />
                    {t('from_diary_badge')}
                  </Badge>
                </div>
              )}

              {/* Body */}
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground">
                {post.body}
              </div>

              {/* Tags */}
              {post.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {post.tags.map(tag => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Meta */}
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-sm text-muted-foreground">
                {/* Author */}
                <span className="flex items-center gap-1">
                  {post.author.isAnonymous
                    ? t('anonymous_author')
                    : (
                        <>
                          {post.author.displayName}
                          {post.author.isDoctorVerified && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                                    <Stethoscope className="size-3" />
                                    <span className="hidden sm:inline">Verified doctor</span>
                                    {post.author.doctorSpecialty && (
                                      <span className="hidden sm:inline">
                                        •
                                        {' '}
                                        {specialtyLabel(post.author.doctorSpecialty)}
                                      </span>
                                    )}
                                    <span className="sr-only">
                                      Verified doctor
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
                <span>{formatDate(post.createdAt)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Comment composer */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <form onSubmit={handleSubmitComment} className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                <MessageCircle className="size-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <textarea
                  value={commentBody}
                  onChange={e => setCommentBody(e.target.value)}
                  placeholder={replyingTo ? 'Write a reply…' : t('comment_placeholder')}
                  rows={3}
                  maxLength={4000}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={commentAnonymous}
                  onChange={e => setCommentAnonymous(e.target.checked)}
                  className="size-4 rounded border-gray-300"
                />
                {commentAnonymous ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {t('post_as_anonymous')}
              </label>

              <div className="flex gap-2">
                {replyingTo && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplyingTo(null)}
                  >
                    Cancel reply
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={commentLoading || !commentBody.trim()}
                >
                  {commentLoading ? '…' : t('post_comment_button')}
                </Button>
              </div>
            </div>
          </form>
        </div>

        {/* Comments list */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {t('replies_count', { count: post.comments.length })}
          </h2>

          {post.comments.length === 0
            ? (
                <div className="rounded-xl border bg-muted/50 p-6 text-center">
                  <MessageCircle className="mx-auto mb-2 size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('empty_comments')}</p>
                </div>
              )
            : (
                <div className="space-y-3">
                  {rootComments.map(comment => (
                    <CommentItem
                      key={comment.id}
                      comment={comment}
                      replies={repliesByParent[comment.id] ?? []}
                      t={t}
                      tMod={tMod}
                      isModerator={isModerator}
                      onReply={id => setReplyingTo(id)}
                      onReport={id => setShowReportModal({ type: 'comment', id })}
                      onToggleVisibility={handleToggleCommentVisibility}
                      visibilityLoading={visibilityLoading}
                    />
                  ))}
                </div>
              )}
        </div>
      </article>

      {/* Report modal */}
      {showReportModal && (
        <ReportModal
          postId={showReportModal.type === 'post' ? showReportModal.id : undefined}
          commentId={showReportModal.type === 'comment' ? showReportModal.id : undefined}
          onClose={() => setShowReportModal(null)}
        />
      )}
    </>
  );
}

function CommentItem({
  comment,
  replies,
  t,
  tMod,
  isModerator,
  onReply,
  onReport,
  onToggleVisibility,
  visibilityLoading,
}: {
  comment: CommunityComment;
  replies: CommunityComment[];
  t: ReturnType<typeof useTranslations<'Community'>>;
  tMod: ReturnType<typeof useTranslations<'Moderation'>>;
  isModerator: boolean;
  onReply: (id: string) => void;
  onReport: (id: string) => void;
  onToggleVisibility: (commentId: string, currentVisibility: CommunityVisibilityType | undefined) => void;
  visibilityLoading: boolean;
}) {
  const isHidden = comment.visibility === 'HIDDEN';

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
    <div className={cn(
      'rounded-lg border bg-card p-4',
      isHidden && 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20',
    )}
    >
      {/* Comment header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          {isHidden && (
            <Badge variant="outline" className="border-amber-500 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              <EyeOff className="mr-1 size-3" />
              {tMod('hidden_indicator')}
            </Badge>
          )}
          <span className="font-medium">
            {comment.author.isAnonymous
              ? t('anonymous_author')
              : comment.author.displayName}
          </span>
          {comment.author.isDoctorVerified && !comment.author.isAnonymous && (
            <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
              <Stethoscope className="size-3" />
              <span className="hidden sm:inline">Verified doctor</span>
              {comment.author.doctorSpecialty && (
                <span className="hidden sm:inline">
                  •
                  {' '}
                  {specialtyLabel(comment.author.doctorSpecialty)}
                </span>
              )}
              <span className="sr-only">
                Verified doctor
                {comment.author.doctorSpecialty
                  ? ` (${specialtyLabel(comment.author.doctorSpecialty)})`
                  : ''}
              </span>
            </span>
          )}
          <span className="text-muted-foreground">•</span>
          <span className="text-muted-foreground">{formatDate(comment.createdAt)}</span>
        </div>

        {/* Actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="size-7 p-0">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onReply(comment.id)}>
              <Reply className="mr-2 size-4" />
              {t('reply_button')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onReport(comment.id)}>
              <Flag className="mr-2 size-4" />
              {t('report_button')}
            </DropdownMenuItem>

            {isModerator && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onToggleVisibility(comment.id, comment.visibility)}
                  disabled={visibilityLoading}
                >
                  {isHidden
                    ? (
                        <>
                          <Eye className="mr-2 size-4" />
                          {tMod('unhide_comment')}
                        </>
                      )
                    : (
                        <>
                          <EyeOff className="mr-2 size-4" />
                          {tMod('hide_comment')}
                        </>
                      )}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Comment body */}
      <p className="whitespace-pre-wrap text-sm">{comment.body}</p>

      {/* Replies */}
      {replies.length > 0 && (
        <div className="ml-4 mt-3 space-y-2 border-l-2 border-muted pl-4">
          {replies.map(reply => (
            <div
              key={reply.id}
              className={cn(
                'rounded-md bg-muted/50 p-3',
                reply.visibility === 'HIDDEN' && 'border border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20',
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  {reply.visibility === 'HIDDEN' && (
                    <Badge variant="outline" className="border-amber-500 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                      <EyeOff className="mr-1 size-2" />
                      {tMod('hidden_indicator')}
                    </Badge>
                  )}
                  <span className="font-medium">
                    {reply.author.isAnonymous
                      ? t('anonymous_author')
                      : reply.author.displayName}
                  </span>
                  {reply.author.isDoctorVerified && !reply.author.isAnonymous && (
                    <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1 py-0.5 text-xs font-medium text-blue-700">
                      <Stethoscope className="size-2.5" />
                      <span className="hidden sm:inline">Verified doctor</span>
                      {reply.author.doctorSpecialty && (
                        <span className="hidden sm:inline">
                          •
                          {' '}
                          {specialtyLabel(reply.author.doctorSpecialty)}
                        </span>
                      )}
                      <span className="sr-only">
                        Verified doctor
                        {reply.author.doctorSpecialty
                          ? ` (${specialtyLabel(reply.author.doctorSpecialty)})`
                          : ''}
                      </span>
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {formatDate(reply.createdAt)}
                  </span>
                </div>

                {/* Reply actions menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="size-6 p-0">
                      <MoreHorizontal className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onReport(reply.id)}>
                      <Flag className="mr-2 size-4" />
                      {t('report_button')}
                    </DropdownMenuItem>

                    {isModerator && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onToggleVisibility(reply.id, reply.visibility)}
                          disabled={visibilityLoading}
                        >
                          {reply.visibility === 'HIDDEN'
                            ? (
                                <>
                                  <Eye className="mr-2 size-4" />
                                  {tMod('unhide_comment')}
                                </>
                              )
                            : (
                                <>
                                  <EyeOff className="mr-2 size-4" />
                                  {tMod('hide_comment')}
                                </>
                              )}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="whitespace-pre-wrap text-sm">{reply.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
