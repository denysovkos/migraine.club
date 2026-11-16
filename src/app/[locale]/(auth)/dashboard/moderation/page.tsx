'use client';

import type { ReportReasonType, UserRoleType } from '@/types/Community';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Flag,
  MessageSquare,
  Search,
  Shield,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TitleBar } from '@/features/dashboard/TitleBar';
import {
  useHiddenContent,
  useOpenReports,
  useResolveReport,
  useUpdateUserRole,
  useUpdateVisibility,
  useUserRole,
  useUsers,
} from '@/hooks/useModeration';
import { cn } from '@/utils/Helpers';

type Tab = 'reports' | 'hidden' | 'users';

export default function ModerationPage() {
  const t = useTranslations('Moderation');
  const searchParams = useSearchParams();
  const { isModerator, isAdmin, loading: roleLoading } = useUserRole();

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('reports');

  // User search state
  const [userSearch, setUserSearch] = useState('');

  // Hooks for data
  const {
    reports,
    loading: reportsLoading,
    error: reportsError,
    refetch: refetchReports,
  } = useOpenReports();
  const {
    items: hiddenItems,
    loading: hiddenLoading,
    error: hiddenError,
    refetch: refetchHidden,
  } = useHiddenContent();
  const {
    users,
    loading: usersLoading,
    error: usersError,
    refetch: refetchUsers,
  } = useUsers(userSearch);

  // Action hooks
  const { resolveReport, loading: resolveLoading } = useResolveReport();
  const { updateVisibility, loading: visibilityLoading } = useUpdateVisibility();
  const { updateRole, loading: roleUpdateLoading } = useUpdateUserRole();

  // Filter reports if postId is in URL
  const postIdFilter = searchParams.get('postId');
  const filteredReports = postIdFilter
    ? reports.filter(r => r.postId === postIdFilter)
    : reports;

  // Handlers
  const handleResolveReport = async (reportId: string, status: 'RESOLVED' | 'DISMISSED') => {
    const success = await resolveReport(reportId, status);
    if (success) {
      refetchReports();
    }
  };

  const handleHideContent = async (postId?: string, commentId?: string) => {
    const success = await updateVisibility({
      postId,
      commentId,
      visibility: 'HIDDEN',
    });
    if (success) {
      refetchReports();
    }
  };

  const handleUnhideContent = async (postId?: string, commentId?: string) => {
    const success = await updateVisibility({
      postId,
      commentId,
      visibility: 'PUBLIC',
    });
    if (success) {
      refetchHidden();
    }
  };

  const handleRoleChange = async (userId: string, role: UserRoleType) => {
    const success = await updateRole(userId, role);
    if (success) {
      refetchUsers();
    }
  };

  const getReasonLabel = (reason: ReportReasonType) => {
    switch (reason) {
      case 'spam':
        return t('report_reason_spam');
      case 'abuse':
        return t('report_reason_abuse');
      case 'misinformation':
        return t('report_reason_misinformation');
      case 'other':
        return t('report_reason_other');
      default:
        return reason;
    }
  };

  const getRoleLabel = (role: UserRoleType) => {
    switch (role) {
      case 'user':
        return t('users_role_user');
      case 'moderator':
        return t('users_role_moderator');
      case 'admin':
        return t('users_role_admin');
      default:
        return role;
    }
  };

  const getRoleIcon = (role: UserRoleType) => {
    switch (role) {
      case 'admin':
        return <ShieldCheck className="size-4" />;
      case 'moderator':
        return <Shield className="size-4" />;
      default:
        return <User className="size-4" />;
    }
  };

  // Not authorized
  if (!roleLoading && !isModerator) {
    return (
      <>
        <TitleBar title={t('page_title')} description={t('page_description')} />
        <div className="rounded-xl border bg-destructive/10 p-8 text-center">
          <Shield className="mx-auto mb-4 size-12 text-destructive" />
          <p className="text-destructive">{t('not_authorized')}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <TitleBar title={t('page_title')} description={t('page_description')} />

      {/* Tab navigation */}
      <div className="mb-6 flex flex-wrap gap-2 border-b pb-4">
        <Button
          variant={activeTab === 'reports' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('reports')}
          className={cn(activeTab === 'reports' && 'pointer-events-none')}
        >
          <Flag className="mr-2 size-4" />
          {t('tabs_reports')}
          {filteredReports.length > 0 && (
            <Badge variant="destructive" className="ml-2">
              {filteredReports.length}
            </Badge>
          )}
        </Button>
        <Button
          variant={activeTab === 'hidden' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('hidden')}
          className={cn(activeTab === 'hidden' && 'pointer-events-none')}
        >
          <EyeOff className="mr-2 size-4" />
          {t('tabs_hidden')}
        </Button>
        {isAdmin && (
          <Button
            variant={activeTab === 'users' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('users')}
            className={cn(activeTab === 'users' && 'pointer-events-none')}
          >
            <User className="mr-2 size-4" />
            {t('tabs_users')}
          </Button>
        )}
      </div>

      {/* Reports tab */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t('reports_title')}</h2>

          {reportsLoading
            ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
                  ))}
                </div>
              )
            : reportsError
              ? (
                  <div className="rounded-xl border bg-destructive/10 p-6 text-center">
                    <p className="text-sm text-destructive">{reportsError}</p>
                  </div>
                )
              : filteredReports.length === 0
                ? (
                    <div className="rounded-xl border bg-muted/50 p-8 text-center">
                      <CheckCircle2 className="mx-auto mb-3 size-10 text-green-500" />
                      <p className="text-sm text-muted-foreground">{t('reports_empty')}</p>
                    </div>
                  )
                : (
                    <div className="space-y-3">
                      {filteredReports.map(report => (
                        <div
                          key={report.id}
                          className="rounded-xl border bg-card p-4 shadow-sm"
                        >
                          {/* Header */}
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline">
                              {report.contentType === 'post'
                                ? t('report_type_post')
                                : t('report_type_comment')}
                            </Badge>
                            <Badge variant="destructive">
                              {getReasonLabel(report.reason)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(report.createdAt).toLocaleString()}
                            </span>
                          </div>

                          {/* Content snippet */}
                          <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
                            {report.contentSnippet}
                          </p>

                          {/* Additional details */}
                          {report.details && (
                            <p className="mb-3 rounded-md bg-muted/50 p-2 text-xs">
                              {report.details}
                            </p>
                          )}

                          {/* Actions */}
                          <div className="flex flex-wrap gap-2">
                            {report.postId && (
                              <Button size="sm" variant="outline" asChild>
                                <Link href={`/dashboard/community/${report.postId}`}>
                                  <Eye className="mr-1 size-4" />
                                  {t('report_action_view')}
                                </Link>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleHideContent(
                                report.postId ?? undefined,
                                report.commentId ?? undefined,
                              )}
                              disabled={visibilityLoading}
                            >
                              <EyeOff className="mr-1 size-4" />
                              {t('report_action_hide')}
                            </Button>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleResolveReport(report.id, 'RESOLVED')}
                              disabled={resolveLoading}
                            >
                              <CheckCircle2 className="mr-1 size-4" />
                              {t('report_action_resolve')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleResolveReport(report.id, 'DISMISSED')}
                              disabled={resolveLoading}
                            >
                              <XCircle className="mr-1 size-4" />
                              {t('report_action_dismiss')}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
        </div>
      )}

      {/* Hidden content tab */}
      {activeTab === 'hidden' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{t('hidden_title')}</h2>

          {hiddenLoading
            ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
                  ))}
                </div>
              )
            : hiddenError
              ? (
                  <div className="rounded-xl border bg-destructive/10 p-6 text-center">
                    <p className="text-sm text-destructive">{hiddenError}</p>
                  </div>
                )
              : hiddenItems.length === 0
                ? (
                    <div className="rounded-xl border bg-muted/50 p-8 text-center">
                      <Eye className="mx-auto mb-3 size-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t('hidden_empty')}</p>
                    </div>
                  )
                : (
                    <div className="space-y-3">
                      {hiddenItems.map(item => (
                        <div
                          key={`${item.type}-${item.id}`}
                          className="rounded-xl border border-amber-500/50 bg-amber-50/50 p-4 shadow-sm dark:bg-amber-950/20"
                        >
                          {/* Header */}
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="border-amber-500">
                              {item.type === 'post'
                                ? (
                                    <>
                                      <MessageSquare className="mr-1 size-3" />
                                      {t('report_type_post')}
                                    </>
                                  )
                                : (
                                    <>
                                      <MessageSquare className="mr-1 size-3" />
                                      {t('report_type_comment')}
                                    </>
                                  )}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(item.hiddenAt).toLocaleString()}
                            </span>
                          </div>

                          {/* Title (for posts) */}
                          {item.title && (
                            <h4 className="mb-1 font-medium">{item.title}</h4>
                          )}

                          {/* Content snippet */}
                          <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                            {item.bodySnippet}
                          </p>

                          {/* Actions */}
                          <div className="flex flex-wrap gap-2">
                            {item.type === 'post' && (
                              <Button size="sm" variant="outline" asChild>
                                <Link href={`/dashboard/community/${item.id}`}>
                                  <Eye className="mr-1 size-4" />
                                  {t('hidden_action_view')}
                                </Link>
                              </Button>
                            )}
                            {item.type === 'comment' && item.postId && (
                              <Button size="sm" variant="outline" asChild>
                                <Link href={`/dashboard/community/${item.postId}`}>
                                  <Eye className="mr-1 size-4" />
                                  {t('hidden_action_view')}
                                </Link>
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleUnhideContent(
                                item.type === 'post' ? item.id : undefined,
                                item.type === 'comment' ? item.id : undefined,
                              )}
                              disabled={visibilityLoading}
                            >
                              <Eye className="mr-1 size-4" />
                              {t('hidden_action_unhide')}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
        </div>
      )}

      {/* Users tab (admin only) */}
      {activeTab === 'users' && isAdmin && (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">{t('users_title')}</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder={t('users_search_placeholder')}
                className="pl-9"
              />
            </div>
          </div>

          {usersLoading
            ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
                  ))}
                </div>
              )
            : usersError
              ? (
                  <div className="rounded-xl border bg-destructive/10 p-6 text-center">
                    <p className="text-sm text-destructive">{usersError}</p>
                  </div>
                )
              : users.length === 0
                ? (
                    <div className="rounded-xl border bg-muted/50 p-8 text-center">
                      <User className="mx-auto mb-3 size-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t('users_empty')}</p>
                    </div>
                  )
                : (
                    <div className="space-y-2">
                      {users.map(user => (
                        <div
                          key={user.id}
                          className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              'flex size-10 items-center justify-center rounded-full',
                              user.role === 'admin' && 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
                              user.role === 'moderator' && 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
                              user.role === 'user' && 'bg-muted text-muted-foreground',
                            )}
                            >
                              {getRoleIcon(user.role)}
                            </div>
                            <div>
                              <p className="font-medium">
                                {user.communityHandle || user.id.slice(0, 12)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {user.id}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <select
                              value={user.role}
                              onChange={e => handleRoleChange(user.id, e.target.value as UserRoleType)}
                              disabled={roleUpdateLoading}
                              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              <option value="user">{getRoleLabel('user')}</option>
                              <option value="moderator">{getRoleLabel('moderator')}</option>
                              <option value="admin">{getRoleLabel('admin')}</option>
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
        </div>
      )}
    </>
  );
}
