'use client';

import type { DiaryTodayResponse } from '@/features/diary/diaryApi';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useEffect, useState } from 'react';
import { fetchTodayDiary, upsertDiaryEntry } from '@/features/diary/diaryApi';
import { showSnackbar } from '@/features/snackbar';

export function NotesModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useTranslations('DashboardHome');
  const [today, setToday] = useState<DiaryTodayResponse | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchTodayDiary()
      .then((res) => {
        if (cancelled) {
          return;
        }
        setToday(res);
        setValue(res.entry?.notes ?? '');
      })
      .catch(() => {
        if (!cancelled) {
          setToday(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  async function save() {
    if (!today || saving) {
      return;
    }
    setSaving(true);
    try {
      await upsertDiaryEntry({
        localDate: today.todayLocalDate,
        patch: { notes: value.trim() ? value.trim() : null },
      });
      showSnackbar({ message: t('note_saved') });
      onSaved?.();
      onClose();
    } catch (e: any) {
      showSnackbar({ message: e?.message ?? t('failed_save_note') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label={t('notes_close_aria')}
        className="mc-scrim-enter absolute inset-0"
        style={{ background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />
      <div
        className="mc-sheet-enter safe-bottom absolute inset-x-0 bottom-0"
        style={{
          background: 'var(--mc-surface)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          boxShadow: 'var(--mc-shadow-lg)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)',
        }}
      >
        <div className="flex flex-col items-center pb-3 pt-2">
          <span className="h-1.5 w-10 rounded-full" style={{ background: 'var(--mc-border-strong)' }} />
        </div>
        <div className="px-5 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-fg-muted)' }}>
                {t('notes_eyebrow')}
              </div>
              <h3 className="text-[18px] font-bold" style={{ color: 'var(--mc-fg)' }}>{t('notes_title')}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('notes_close')}
              className="mc-ring flex size-9 items-center justify-center rounded-full"
              style={{ background: 'var(--mc-bg-subtle)', color: 'var(--mc-fg-muted)' }}
            >
              <X className="size-[18px]" />
            </button>
          </div>
          <p className="mt-1 text-[12.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
            {t('notes_description')}
          </p>
        </div>
        <div className="px-5 pb-4">
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={t('notes_placeholder')}
            disabled={loading || saving}
            rows={5}
            className="mc-ring w-full resize-none rounded-2xl p-3 text-[14px]"
            style={{
              background: 'var(--mc-surface)',
              border: '1px solid var(--mc-border)',
              color: 'var(--mc-fg)',
            }}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="mc-ring flex-1 rounded-full py-2.5 text-[13px] font-semibold"
              style={{
                background: 'var(--mc-surface)',
                color: 'var(--mc-fg-2)',
                border: '1px solid var(--mc-border)',
              }}
            >
              {t('notes_cancel')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={loading || saving}
              className="mc-ring flex-1 rounded-full py-2.5 text-[13px] font-semibold disabled:opacity-60"
              style={{ background: 'var(--mc-brand)', color: 'var(--mc-brand-fg)' }}
            >
              {saving ? t('notes_saving') : t('notes_save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
