'use client';

import type { ReportReasonType } from '@/types/Community';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSubmitReport } from '@/hooks/useModeration';

type ReportModalProps = {
  postId?: string;
  commentId?: string;
  onClose: () => void;
  onSuccess?: () => void;
};

const REPORT_REASONS: ReportReasonType[] = ['spam', 'abuse', 'misinformation', 'other'];

export function ReportModal({ postId, commentId, onClose, onSuccess }: ReportModalProps) {
  const t = useTranslations('Moderation');
  const { submitReport, loading } = useSubmitReport();
  const [reason, setReason] = useState<ReportReasonType | ''>('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      return;
    }

    setError(null);
    const success = await submitReport({
      postId,
      commentId,
      reason,
      details: details.trim() || undefined,
    });

    if (success) {
      onSuccess?.();
      onClose();
    } else {
      setError(t('report_error'));
    }
  };

  const getReasonLabel = (r: ReportReasonType) => {
    switch (r) {
      case 'spam':
        return t('report_reason_spam');
      case 'abuse':
        return t('report_reason_abuse');
      case 'misinformation':
        return t('report_reason_misinformation');
      case 'other':
        return t('report_reason_other');
      default:
        return r;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="text-lg font-semibold">{t('report_modal_title')}</h3>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4">
          {/* Reason select */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium">
              {t('report_modal_reason_label')}
            </label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as ReportReasonType)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="">{t('report_modal_reason_placeholder')}</option>
              {REPORT_REASONS.map(r => (
                <option key={r} value={r}>
                  {getReasonLabel(r)}
                </option>
              ))}
            </select>
          </div>

          {/* Details textarea */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium">
              {t('report_modal_details_label')}
            </label>
            <textarea
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder={t('report_modal_details_placeholder')}
              rows={3}
              maxLength={2000}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="mb-4 text-sm text-destructive">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              {t('report_modal_cancel')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={loading || !reason}
            >
              {loading ? '…' : t('report_modal_submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
