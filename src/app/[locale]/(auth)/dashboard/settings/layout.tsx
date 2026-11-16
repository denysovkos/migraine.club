'use client';

import { Bell, CalendarDays, CircleHelp, ClipboardCheck, LayoutGrid, ListChecks, MapPin, Pill, Settings, Shield, Sparkles, Stethoscope, User, UserCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { TitleBar } from '@/features/dashboard/TitleBar';
import { cn } from '@/utils/Helpers';

const settingsNavItems = [
  {
    key: 'profile',
    href: '/dashboard/settings/profile',
    icon: UserCircle,
  },
  {
    key: 'medications',
    href: '/dashboard/settings/medications',
    icon: Pill,
  },
  {
    key: 'treatments',
    href: '/dashboard/settings/treatments',
    icon: Sparkles,
  },
  {
    key: 'doctor_verification',
    href: '/dashboard/settings/doctor-verification',
    icon: Stethoscope,
  },
  {
    key: 'account',
    href: '/dashboard/settings/account',
    icon: User,
  },
  {
    key: 'location',
    href: '/dashboard/settings/location',
    icon: MapPin,
  },
  {
    key: 'notifications',
    href: '/dashboard/settings/notifications',
    icon: Bell,
  },
  {
    key: 'modules',
    href: '/dashboard/settings/modules',
    icon: LayoutGrid,
  },
  {
    key: 'cycle',
    href: '/dashboard/settings/cycle',
    icon: CalendarDays,
  },
  {
    key: 'programs',
    href: '/dashboard/settings/programs',
    icon: ListChecks,
  },
  {
    key: 'privacy',
    href: '/dashboard/settings/privacy',
    icon: Shield,
  },
  {
    key: 'help_faq',
    href: '/dashboard/settings/help',
    icon: CircleHelp,
  },
  {
    key: 'baseline',
    href: '/onboarding',
    icon: ClipboardCheck,
  },
] as const;

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations('Settings');
  const tIntake = useTranslations('Intake');
  const pathname = usePathname();

  return (
    <>
      <TitleBar
        title={(
          <span className="flex items-center gap-2">
            <Settings className="size-6" />
            {t('title')}
          </span>
        )}
        description={t('description')}
      />

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {/* Sidebar Navigation */}
        <nav className="w-full shrink-0 lg:w-56">
          <ul className="flex flex-row gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {settingsNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.includes(item.href);

              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    {item.key === 'baseline' ? tIntake('settings_row_label') : t(`nav.${item.key}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Main Content */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </>
  );
}
