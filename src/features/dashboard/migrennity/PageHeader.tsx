'use client';

import { Moon, Sun } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useUserProfileContext } from '@/features/auth/UserProfileProvider';
import { useThemeMode } from '@/features/theme';

export function PageHeader() {
  const t = useTranslations('DashboardHome');
  const { displayName } = useUserProfileContext();
  const { isDark, toggleTheme } = useThemeMode();

  const firstName = useMemo(() => {
    if (!displayName) {
      return null;
    }
    const trimmed = displayName.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.split(/\s+/)[0] ?? trimmed;
  }, [displayName]);

  const todayLabel = useMemo(() => DateTime.local().toFormat('ccc, LLL d, yyyy'), []);

  return (
    <header
      className="safe-top sticky top-0 z-20"
      style={{
        background: 'color-mix(in oklab, var(--mc-bg) 88%, transparent)',
        backdropFilter: 'saturate(140%) blur(10px)',
        WebkitBackdropFilter: 'saturate(140%) blur(10px)',
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-fg-muted)' }}>
              {t('page_header_today')}
            </span>
            <span className="mc-tnum text-[12px]" style={{ color: 'var(--mc-fg-faint)' }}>
              ·
              {' '}
              {todayLabel}
            </span>
          </div>
          <h1
            className="truncate text-[22px] font-bold leading-tight tracking-tight md:text-[26px]"
            style={{ color: 'var(--mc-fg)' }}
          >
            {firstName ? t('page_header_greeting_named', { name: firstName }) : t('page_header_greeting')}
          </h1>
        </div>
        <button
          type="button"
          aria-label={t('page_header_toggle_theme')}
          className="mc-ring flex size-10 items-center justify-center rounded-full md:hidden"
          style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', color: 'var(--mc-fg-2)' }}
          onClick={toggleTheme}
        >
          {isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>
      </div>
    </header>
  );
}
