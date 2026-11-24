'use client';

import type { MenuIconKey, MenuItem } from '@/features/dashboard/DashboardHeader';
import { UserButton } from '@clerk/nextjs';
import {
  BarChart3,
  Bolt,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Home,
  LayoutDashboard,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  Plus,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Stethoscope,
  Sun,
  Target,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useState } from 'react';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { useThemeMode } from '@/features/theme';
import { useUserRole } from '@/hooks/useModeration';
import { AppConfig } from '@/utils/AppConfig';

import { ActionSheet } from './ActionSheet';
import { MoreMenuModal } from './MoreMenuModal';

const ICON_MAP: Record<MenuIconKey, typeof Home> = {
  dashboard: Home,
  episodes: Bolt,
  diary: CalendarDays,
  outcomes: BarChart3,
  insights: Sparkles,
  questionnaires: ClipboardList,
  community: MessageSquareText,
  share: Share2,
  moderation: Shield,
  admin: Shield,
  doctor_verifications: Stethoscope,
  reports: FileText,
  programs: Target,
  settings: Settings,
};

function IconFor(key?: MenuIconKey) {
  if (!key) {
    return LayoutDashboard;
  }
  return ICON_MAP[key] ?? LayoutDashboard;
}

function normalizePath(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
}

function isItemActive(href: string, pathname: string, exact?: boolean) {
  const p = normalizePath(pathname);
  if (exact) {
    return p === href;
  }
  return p === href || p.startsWith(`${href}/`);
}

export function DashboardChrome({ menu, children }: { menu: MenuItem[]; children: React.ReactNode }) {
  const t = useTranslations('DashboardNav');
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, isModerator } = useUserRole();
  const { mounted, isDark, toggleTheme } = useThemeMode();
  const [expanded, setExpanded] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const visibleMenu = menu.filter((item) => {
    if (item.adminOnly && !isAdmin) {
      return false;
    }
    if (item.moderatorOnly && !isModerator) {
      return false;
    }
    if (item.hideForAdmin && isAdmin) {
      return false;
    }
    return true;
  });

  const bottomLeft = [
    visibleMenu.find(m => m.href === '/dashboard'),
    visibleMenu.find(m => m.href === '/dashboard/diary'),
  ].filter((x): x is MenuItem => Boolean(x));
  const bottomRight = [
    visibleMenu.find(m => m.href === '/dashboard/episodes'),
  ].filter((x): x is MenuItem => Boolean(x));

  const railWidth = expanded ? 232 : 64;

  return (
    <div className="mc-app min-h-screen" style={{ ['--mc-rail-w' as any]: `${railWidth}px` }}>
      <aside
        className={`mc-rail fixed inset-y-0 left-0 z-30 hidden flex-col md:flex ${expanded ? 'mc-rail--expanded' : ''}`}
        style={{ background: 'var(--mc-surface)', borderRight: '1px solid var(--mc-border)' }}
      >
        <div className={`flex h-[64px] items-center py-5 ${expanded ? 'gap-3 px-4' : 'justify-center px-2'}`}>
          <Link
            href="/dashboard"
            aria-label={t('home_aria', { name: AppConfig.name })}
            className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
            style={{ background: 'var(--mc-brand)', color: 'var(--mc-brand-fg)' }}
          >
            <svg
              className="size-[20px]"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="8" r="4.5" />
              <path d="M7 21a5 5 0 0 1 10 0" />
              <path d="M12.5 4.5 10.5 8h2L11 11.5" />
            </svg>
          </Link>
          <div className="mc-lbl text-[15px] font-bold leading-tight" style={{ color: 'var(--mc-fg)' }}>
            {AppConfig.name}
          </div>
        </div>

        <nav className={`mc-no-bar flex-1 overflow-y-auto py-2 ${expanded ? 'px-3' : 'px-2'}`}>
          {visibleMenu.map((item) => {
            const Icon = IconFor(item.icon);
            const on = isItemActive(item.href, pathname, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                title={!expanded ? item.label : undefined}
                className={`mc-ring flex w-full items-center rounded-xl py-2.5 transition-colors ${expanded ? 'gap-3 px-3' : 'justify-center'}`}
                style={{
                  background: on ? 'var(--mc-brand-soft)' : 'transparent',
                  color: on ? 'var(--mc-brand-press)' : 'var(--mc-fg-2)',
                  fontWeight: on ? 600 : 500,
                }}
              >
                <Icon className="size-5 shrink-0" strokeWidth={on ? 2 : 1.7} />
                <span className="mc-lbl text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={expanded ? 'p-3' : 'px-2 py-3'} style={{ borderTop: '1px solid var(--mc-border)' }}>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? t('collapse_nav') : t('expand_nav')}
            title={expanded ? t('collapse') : t('expand')}
            className={`mc-ring flex w-full items-center rounded-xl py-2.5 text-sm ${expanded ? 'gap-3 px-3' : 'justify-center'}`}
            style={{ color: 'var(--mc-fg-muted)' }}
          >
            {expanded ? <ChevronLeft className="size-[18px]" /> : <ChevronRight className="size-[18px]" />}
            <span className="mc-lbl">{t('collapse')}</span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? t('light_mode') : t('dim_mode')}
            title={isDark ? t('light_mode') : t('dim_mode')}
            className={`mc-ring mt-1 flex w-full items-center rounded-xl py-2.5 text-sm ${expanded ? 'gap-3 px-3' : 'justify-center'}`}
            style={{ color: 'var(--mc-fg-muted)' }}
          >
            {isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            <span className="mc-lbl">
              {isDark ? t('light_mode') : t('dim_mode')}
            </span>
          </button>
          {mounted && (
            <div className={`mt-3 flex items-center gap-3 ${expanded ? 'px-2' : 'justify-center'}`}>
              <UserButton
                userProfileMode="navigation"
                userProfileUrl="/dashboard/settings/account"
              />
              {expanded && (
                <div className="min-w-0 flex-1">
                  <LocaleSwitcher />
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-col pb-28 transition-[margin-left] duration-200 md:ml-[var(--mc-rail-w)] md:pb-12">
        {children}
      </main>

      <nav
        className="mc-bn-blur safe-bottom fixed inset-x-0 bottom-0 z-30 md:hidden"
        style={{ paddingTop: 6 }}
      >
        <ul className="grid grid-cols-5 px-2">
          {bottomLeft.map((it) => {
            const Icon = IconFor(it.icon);
            const on = isItemActive(it.href, pathname, it.exact);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className="mc-ring flex w-full flex-col items-center gap-1 rounded-lg py-2"
                  style={{ color: on ? 'var(--mc-brand-press)' : 'var(--mc-fg-muted)' }}
                >
                  <Icon className="size-[22px]" strokeWidth={on ? 2 : 1.5} />
                  <span className="text-[10.5px] font-semibold tracking-wide">{it.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="-mt-7 flex justify-center">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label={t('quick_log')}
              className="mc-fab mc-ring flex size-14 items-center justify-center rounded-full"
            >
              <Plus className="size-6" strokeWidth={2.25} />
            </button>
          </li>
          {bottomRight.map((it) => {
            const Icon = IconFor(it.icon);
            const on = isItemActive(it.href, pathname, it.exact);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className="mc-ring flex w-full flex-col items-center gap-1 rounded-lg py-2"
                  style={{ color: on ? 'var(--mc-brand-press)' : 'var(--mc-fg-muted)' }}
                >
                  <Icon className="size-[22px]" strokeWidth={on ? 2 : 1.5} />
                  <span className="text-[10.5px] font-semibold tracking-wide">{it.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label={t('more_menu')}
              className="mc-ring flex w-full flex-col items-center gap-1 rounded-lg py-2"
              style={{ color: moreOpen ? 'var(--mc-brand-press)' : 'var(--mc-fg-muted)' }}
            >
              <MoreHorizontal className="size-[22px]" strokeWidth={1.5} />
              <span className="text-[10.5px] font-semibold tracking-wide">{t('more')}</span>
            </button>
          </li>
        </ul>
      </nav>

      <ActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onDidChange={() => router.refresh()}
      />

      <MoreMenuModal
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        menu={visibleMenu}
        iconFor={IconFor}
      />
    </div>
  );
}
