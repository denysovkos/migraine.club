import type { MenuItem } from '@/features/dashboard/DashboardHeader';
import { useTranslations } from 'next-intl';

import { getTranslations } from 'next-intl/server';
import { DashboardChrome } from '@/features/dashboard/migrennity/DashboardChrome';
import { IntakeGate } from '@/features/intake/IntakeGate';
import { SnackbarViewport } from '@/features/snackbar';
import { AuthenticatedThemeProvider } from '@/features/theme';
import { Env } from '@/libs/Env';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({
    locale: (await props.params).locale,
    namespace: 'Dashboard',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default function DashboardLayout(props: { children: React.ReactNode }) {
  const t = useTranslations('DashboardLayout');
  const tMod = useTranslations('Moderation');
  const tAdmin = useTranslations('Admin');

  const insightsEnabled = !!Env.ENABLE_F39_INSIGHTS;
  const menu: MenuItem[] = [
    { href: '/dashboard', label: t('home'), exact: true, icon: 'dashboard' },
    { href: '/dashboard/episodes', label: t('episodes'), icon: 'episodes' },
    { href: '/dashboard/diary', label: t('diary'), icon: 'diary' },
    { href: '/dashboard/outcomes', label: t('outcomes'), icon: 'outcomes' },
  ];

  if (insightsEnabled) {
    menu.push({ href: '/dashboard/insights', label: t('insights'), icon: 'insights' });
  }

  menu.push(
    { href: '/dashboard/programs', label: t('programs'), icon: 'programs' },
    { href: '/dashboard/questionnaires', label: t('questionnaires'), icon: 'questionnaires' },
    { href: '/dashboard/reports', label: 'Reports', icon: 'reports' },
    { href: '/dashboard/community', label: t('community'), icon: 'community' },
    { href: '/dashboard/share', label: t('share'), icon: 'share' },
    {
      href: '/dashboard/moderation',
      label: tMod('nav_title'),
      moderatorOnly: true,
      hideForAdmin: true,
      icon: 'moderation',
    },
    { href: '/dashboard/admin', label: tAdmin('nav_title'), adminOnly: true, icon: 'admin' },
    { href: '/dashboard/settings', label: t('settings'), icon: 'settings' },
  );

  return (
    <AuthenticatedThemeProvider>
      <DashboardChrome menu={menu}>
        <IntakeGate>
          <div className="px-4 pt-4 md:px-8 md:pt-6 xl:px-10">
            {props.children}
          </div>
        </IntakeGate>
      </DashboardChrome>
      <SnackbarViewport />
    </AuthenticatedThemeProvider>
  );
}

export const dynamic = 'force-dynamic';
