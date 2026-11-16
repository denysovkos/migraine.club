'use client';

import type { LucideIcon } from 'lucide-react';
import type { DiaryTodayResponse } from '@/features/diary/diaryApi';
import type { Episode } from '@/types/Episode';
import { Check, ChevronRight, NotebookPen, Pencil, Pill, Sparkles, X } from 'lucide-react';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { fetchTodayDiary, upsertDiaryEntry } from '@/features/diary/diaryApi';
import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';
import { showSnackbar } from '@/features/snackbar';

import { fetchOngoingEpisode } from './dataHelpers';
import { NotesModal } from './NotesModal';

type ActionId = 'attack' | 'med' | 'free' | 'note';

type Item = {
  id: ActionId;
  label: string;
  sub: string;
  icon: LucideIcon;
  bg: string;
  fg: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function ActionSheet({
  open,
  onClose,
  onDidChange,
}: {
  open: boolean;
  onClose: () => void;
  onDidChange?: () => void;
}) {
  const t = useTranslations('DashboardHome');
  const router = useRouter();
  const [ongoing, setOngoing] = useState<Episode | null>(null);
  const [today, setToday] = useState<DiaryTodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [takeMedOpen, setTakeMedOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [markingFree, setMarkingFree] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchOngoingEpisode(), fetchTodayDiary().catch(() => null)])
      .then(([ep, td]) => {
        if (cancelled) {
          return;
        }
        setOngoing(ep);
        setToday(td);
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

  const hasOngoing = !!ongoing;
  const todayDayType = today?.entry?.dayType ?? null;
  const isPainDay = todayDayType === 'headache_day' || todayDayType === 'migraine_day';
  const isAlreadyFree = todayDayType === 'headache_free';

  const items: Item[] = useMemo(() => [
    hasOngoing
      ? {
          id: 'attack',
          label: t('action_edit_ongoing_attack'),
          sub: t('action_edit_ongoing_attack_sub'),
          icon: Pencil,
          bg: '#ede9fe',
          fg: '#6d28d9',
        }
      : {
          id: 'attack',
          label: t('action_log_attack'),
          sub: t('action_log_attack_sub'),
          icon: Sparkles,
          bg: '#ede9fe',
          fg: '#6d28d9',
        },
    {
      id: 'med',
      label: t('action_take_medication'),
      sub: hasOngoing ? t('action_take_medication_sub_ongoing') : t('action_take_medication_sub_default'),
      icon: Pill,
      bg: 'var(--mc-med-bg)',
      fg: 'var(--mc-med-fg)',
    },
    {
      id: 'free',
      label: isAlreadyFree ? t('action_already_pain_free') : t('action_mark_pain_free'),
      sub: hasOngoing
        ? t('action_free_sub_ongoing')
        : isPainDay
          ? t('action_free_sub_pain_day')
          : isAlreadyFree
            ? t('action_free_sub_already')
            : t('action_free_sub_default'),
      icon: Check,
      bg: 'var(--mc-good-bg)',
      fg: 'var(--mc-good-fg)',
      disabled: hasOngoing || isPainDay || isAlreadyFree,
    },
    {
      id: 'note',
      label: t('action_add_note'),
      sub: t('action_add_note_sub'),
      icon: NotebookPen,
      bg: 'var(--mc-brand-soft)',
      fg: 'var(--mc-brand-press)',
    },
  ], [hasOngoing, isPainDay, isAlreadyFree, t]);

  async function handleAction(id: ActionId) {
    if (id === 'attack') {
      if (hasOngoing && ongoing) {
        router.push(`/dashboard/episodes/${ongoing.id}`);
        onClose();
      } else {
        router.push('/dashboard/episodes/new');
        onClose();
      }
      return;
    }
    if (id === 'med') {
      setTakeMedOpen(true);
      return;
    }
    if (id === 'note') {
      setNoteOpen(true);
      return;
    }
    if (id === 'free') {
      if (!today || markingFree) {
        return;
      }
      setMarkingFree(true);
      try {
        await upsertDiaryEntry({
          localDate: today.todayLocalDate,
          patch: { dayType: 'headache_free' },
        });
        showSnackbar({ message: t('marked_pain_free') });
        onDidChange?.();
        onClose();
      } catch (e: any) {
        showSnackbar({ message: e?.message ?? t('failed_to_save') });
      } finally {
        setMarkingFree(false);
      }
    }
  }

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-40">
        <button
          type="button"
          aria-label={t('actionsheet_close_quick_log')}
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
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[18px] font-bold" style={{ color: 'var(--mc-fg)' }}>{t('actionsheet_title')}</h3>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('actionsheet_close')}
                className="mc-ring rounded-full p-1"
                style={{ color: 'var(--mc-fg-muted)' }}
              >
                <X className="size-5" />
              </button>
            </div>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--mc-fg-muted)' }}>
              {loading ? t('actionsheet_subtitle_loading') : t('actionsheet_subtitle')}
            </p>
          </div>
          <ul className="space-y-1.5 px-3 pb-4">
            {items.map((it) => {
              const Icon = it.icon;
              const disabled = !!it.disabled || (it.id === 'free' && markingFree);
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => handleAction(it.id)}
                    disabled={disabled || loading}
                    className="mc-ring flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)' }}
                  >
                    <span
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: it.bg, color: it.fg }}
                    >
                      <Icon className="size-5" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold leading-tight" style={{ color: 'var(--mc-fg)' }}>
                        {it.label}
                      </span>
                      <span className="mt-0.5 block text-[12.5px]" style={{ color: 'var(--mc-fg-muted)' }}>
                        {it.sub}
                      </span>
                    </span>
                    {!disabled && <ChevronRight className="size-[18px] shrink-0" style={{ color: 'var(--mc-fg-muted)' }} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <TakeMedicationSheet
        open={takeMedOpen}
        onOpenChange={(v) => {
          setTakeMedOpen(v);
          if (!v) {
            onClose();
          }
        }}
        episodeId={(ongoing as any)?.id ?? null}
        onDidLog={() => {
          onDidChange?.();
        }}
      />

      <NotesModal
        open={noteOpen}
        onClose={() => {
          setNoteOpen(false);
          onClose();
        }}
        onSaved={() => onDidChange?.()}
      />
    </>
  );
}
