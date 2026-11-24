'use client';

import type { LucideIcon } from 'lucide-react';
import type { MenuIconKey, MenuItem } from '@/features/dashboard/DashboardHeader';
import { UserButton } from '@clerk/nextjs';
import { Moon, Sun, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useEffect } from 'react';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { useThemeMode } from '@/features/theme';

type IconResolver = (key?: MenuIconKey) => LucideIcon;

function isItemActive(href: string, pathname: string, exact?: boolean) {
  const p = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
  if (exact) {
    return p === href;
  }
  return p === href || p.startsWith(`${href}/`);
}

export function MoreMenuModal({
  open,
  onClose,
  menu,
  iconFor,
}: {
  open: boolean;
  onClose: () => void;
  menu: MenuItem[];
  iconFor: IconResolver;
}) {
  const t = useTranslations('DashboardNav');
  const pathname = usePathname();
  const { isDark, toggleTheme } = useThemeMode();

  useEffect(() => {
    if (!open) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <div
        className="mc-scrim-enter absolute inset-0"
        style={{ background: 'var(--mc-bg)' }}
        onClick={onClose}
        aria-hidden
      />

      <div className="safe-top safe-bottom relative flex h-full flex-col" style={{ background: 'var(--mc-bg)' }}>
        <header className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--mc-border)' }}>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--mc-fg-muted)' }}>
              {t('menu_eyebrow')}
            </div>
            <h2 className="text-[20px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
              {t('menu_title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close_menu')}
            className="mc-ring flex size-10 items-center justify-center rounded-full"
            style={{ background: 'var(--mc-surface)', border: '1px solid var(--mc-border)', color: 'var(--mc-fg-2)' }}
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <ul className="grid grid-cols-3 gap-3">
            {menu.map((item) => {
              const Icon = iconFor(item.icon);
              const on = isItemActive(item.href, pathname, item.exact);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className="mc-ring flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center"
                    style={{
                      background: on ? 'var(--mc-brand-soft)' : 'var(--mc-surface)',
                      border: `1px solid ${on ? 'transparent' : 'var(--mc-border)'}`,
                      color: on ? 'var(--mc-brand-press)' : 'var(--mc-fg-2)',
                      fontWeight: on ? 600 : 500,
                    }}
                  >
                    <Icon className="size-7" strokeWidth={on ? 2 : 1.6} />
                    <span className="text-[12.5px] leading-tight">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div
          className="px-4 py-3"
          style={{ borderTop: '1px solid var(--mc-border)', background: 'var(--mc-surface)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={toggleTheme}
              className="mc-ring flex items-center gap-2 rounded-full px-3 py-2 text-[13px] font-semibold"
              style={{ background: 'var(--mc-bg-subtle)', color: 'var(--mc-fg-2)' }}
            >
              {isDark ? <Sun className="size-[16px]" /> : <Moon className="size-[16px]" />}
              {isDark ? t('light_mode') : t('dim_mode')}
            </button>
            <div className="flex items-center gap-2">
              <LocaleSwitcher />
              <UserButton
                userProfileMode="navigation"
                userProfileUrl="/dashboard/settings/account"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
