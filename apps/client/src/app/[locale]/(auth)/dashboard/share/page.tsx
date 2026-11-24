'use client';

import { formatDistanceToNow } from 'date-fns';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { getBaseUrl } from '@/utils/Helpers';

type ShareLink = {
  id: string;
  token: string;
  label: string | null;
  recipientName: string | null;
  expiresAt: string;
  accessCount: number;
  lastAccessedAt: string | null;
  isRevoked: boolean;
  createdAt: string;
};

export default function ShareLinksPage() {
  const t = useTranslations('ShareLinks');
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [label, setLabel] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [patientDisplayName, setPatientDisplayName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(7);

  const fetchLinks = async () => {
    try {
      const response = await fetch('/api/share');
      if (response.ok) {
        const data = await response.json();
        setLinks(data);
      }
    } catch (error) {
      console.error('Failed to fetch share links:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label || undefined,
          recipientName: recipientName || undefined,
          patientDisplayName: patientDisplayName || undefined,
          expiresInDays,
        }),
      });

      if (response.ok) {
        setShowForm(false);
        setLabel('');
        setRecipientName('');
        setPatientDisplayName('');
        setExpiresInDays(7);
        fetchLinks();
      }
    } catch (error) {
      console.error('Failed to create share link:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    // Using window.confirm for simplicity - can be replaced with a modal dialog
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('revoke_confirm'))) {
      return;
    }

    try {
      const response = await fetch('/api/share', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (response.ok) {
        fetchLinks();
      }
    } catch (error) {
      console.error('Failed to revoke share link:', error);
    }
  };

  const copyToClipboard = async (token: string, id: string) => {
    const url = `${getBaseUrl()}/share/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(setCopiedId, 2000, null);
  };

  const getStatus = (link: ShareLink) => {
    if (link.isRevoked) {
      return { label: t('status_revoked'), variant: 'destructive' as const };
    }
    if (new Date(link.expiresAt) < new Date()) {
      return { label: t('status_expired'), variant: 'secondary' as const };
    }
    return { label: t('status_active'), variant: 'default' as const };
  };

  return (
    <>
      <TitleBar
        title={t('title')}
        description={t('description')}
      />

      <div className="mt-6 space-y-6">
        {/* Create new link section */}
        <DashboardSection
          title={t('create_title')}
          description={t('create_description')}
        >
          {!showForm
            ? (
                <Button onClick={() => setShowForm(true)}>
                  <Plus className="mr-2 size-4" />
                  {t('create_button')}
                </Button>
              )
            : (
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="label">{t('form_label')}</Label>
                      <Input
                        id="label"
                        placeholder={t('form_label_placeholder')}
                        value={label}
                        onChange={e => setLabel(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="recipientName">{t('form_recipient')}</Label>
                      <Input
                        id="recipientName"
                        placeholder={t('form_recipient_placeholder')}
                        value={recipientName}
                        onChange={e => setRecipientName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="patientDisplayName">{t('form_patient_name')}</Label>
                      <Input
                        id="patientDisplayName"
                        placeholder={t('form_patient_name_placeholder')}
                        value={patientDisplayName}
                        onChange={e => setPatientDisplayName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="expiresInDays">{t('form_expires')}</Label>
                      <select
                        id="expiresInDays"
                        value={expiresInDays}
                        onChange={e => setExpiresInDays(Number(e.target.value))}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value={1}>
                          1
                          {t('day')}
                        </option>
                        <option value={3}>
                          3
                          {t('days')}
                        </option>
                        <option value={7}>
                          7
                          {t('days')}
                        </option>
                        <option value={14}>
                          14
                          {t('days')}
                        </option>
                        <option value={30}>
                          30
                          {t('days')}
                        </option>
                        <option value={90}>
                          90
                          {t('days')}
                        </option>
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" disabled={creating}>
                      {creating
                        ? (
                            <>
                              <Loader2 className="mr-2 size-4 animate-spin" />
                              {t('creating')}
                            </>
                          )
                        : (
                            <>
                              <Share2 className="mr-2 size-4" />
                              {t('create_link')}
                            </>
                          )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowForm(false)}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                </form>
              )}
        </DashboardSection>

        {/* Existing links */}
        <DashboardSection
          title={t('links_title')}
          description={t('links_description')}
        >
          {loading
            ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              )
            : links.length === 0
              ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <Link2 className="mx-auto mb-2 size-8" />
                    <p>{t('no_links')}</p>
                  </div>
                )
              : (
                  <div className="space-y-3">
                    {links.map(link => (
                      <div
                        key={link.id}
                        className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {link.label || link.recipientName || t('unnamed_link')}
                            </span>
                            <Badge variant={getStatus(link).variant}>
                              {getStatus(link).label}
                            </Badge>
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            <span>
                              {t('created')}
                              {' '}
                              {formatDistanceToNow(new Date(link.createdAt), {
                                addSuffix: true,
                              })}
                            </span>
                            {link.accessCount > 0 && (
                              <span className="ml-3">
                                {t('accessed')}
                                {' '}
                                {link.accessCount}
                                {' '}
                                {link.accessCount === 1 ? t('time') : t('times')}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t('expires')}
                            :
                            {' '}
                            {new Date(link.expiresAt).toLocaleDateString()}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          {!link.isRevoked
                            && new Date(link.expiresAt) >= new Date() && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => copyToClipboard(link.token, link.id)}
                              >
                                {copiedId === link.id
                                  ? (
                                      <>
                                        <Check className="mr-1 size-4" />
                                        {t('copied')}
                                      </>
                                    )
                                  : (
                                      <>
                                        <Copy className="mr-1 size-4" />
                                        {t('copy')}
                                      </>
                                    )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                              >
                                <a
                                  href={`${getBaseUrl()}/share/${link.token}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="mr-1 size-4" />
                                  {t('open')}
                                </a>
                              </Button>
                            </>
                          )}
                          {!link.isRevoked && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleRevoke(link.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
        </DashboardSection>
      </div>
    </>
  );
}
