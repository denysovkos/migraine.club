'use client';

import { UserButton } from '@clerk/nextjs';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Stethoscope,
  Target,
} from 'lucide-react';
import Link from 'next/link';

import { ActiveLink } from '@/components/ActiveLink';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ToggleMenuButton } from '@/components/ToggleMenuButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { ThemeToggleButton } from '@/features/theme/ThemeToggleButton';
import { useUserRole } from '@/hooks/useModeration';
import { Logo } from '@/templates/Logo';

export type MenuIconKey
  = | 'dashboard'
    | 'episodes'
    | 'diary'
    | 'outcomes'
    | 'insights'
    | 'questionnaires'
    | 'community'
    | 'share'
    | 'moderation'
    | 'settings'
    | 'admin'
    | 'doctor_verifications'
    | 'reports'
    | 'programs';

export type MenuItem = {
  href: string;
  label: string;
  exact?: boolean;
  moderatorOnly?: boolean;
  adminOnly?: boolean;
  hideForAdmin?: boolean;
  icon?: MenuIconKey;
};

export const DashboardHeader = (props: {
  menu: MenuItem[];
  variant?: 'top' | 'sidebar';
}) => {
  const { isModerator, isAdmin } = useUserRole();
  const variant = props.variant ?? 'top';

  // Filter menu items based on user role
  const visibleMenu = props.menu.filter((item) => {
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

  const IconFor = (key?: MenuIconKey) => {
    switch (key) {
      case 'dashboard':
        return LayoutDashboard;
      case 'episodes':
        return ListChecks;
      case 'diary':
        return CalendarDays;
      case 'outcomes':
        return BarChart3;
      case 'insights':
        return Sparkles;
      case 'questionnaires':
        return ClipboardList;
      case 'community':
        return MessageSquareText;
      case 'share':
        return Share2;
      case 'moderation':
      case 'admin':
        return Shield;
      case 'doctor_verifications':
        return Stethoscope;
      case 'reports':
        return FileText;
      case 'programs':
        return Target;
      case 'settings':
        return Settings;
      default:
        return null;
    }
  };

  if (variant === 'sidebar') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center">
          <Link href="/dashboard" className="inline-flex items-center p-2">
            <Logo />
          </Link>
        </div>

        <Separator className="my-4" />

        <nav className="flex-1">
          <ul className="flex flex-col gap-1 text-sm font-medium [&_a:hover]:opacity-100 [&_a]:opacity-75">
            {visibleMenu.map(item => (
              <li key={item.href}>
                <ActiveLink href={item.href} exact={item.exact}>
                  <span className="inline-flex items-center gap-2">
                    {(() => {
                      const Icon = IconFor(item.icon);
                      return Icon ? <Icon className="size-4" /> : null;
                    })()}
                    <span>{item.label}</span>
                  </span>
                </ActiveLink>
              </li>
            ))}
          </ul>
        </nav>

        <Separator className="my-4" />

        <div className="flex items-center justify-between gap-2">
          <ThemeToggleButton />
          <LocaleSwitcher />

          <UserButton
            userProfileMode="navigation"
            userProfileUrl="/dashboard/settings/account"
            appearance={{
              elements: {
                rootBox: 'px-2 py-1.5',
              },
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center">
        <Link href="/dashboard">
          <Logo />
        </Link>

        <nav className="ml-6 max-lg:hidden">
          <ul className="flex flex-row items-center gap-x-3 text-lg font-medium [&_a:hover]:opacity-100 [&_a]:opacity-75">
            {visibleMenu.map(item => (
              <li key={item.href}>
                <ActiveLink href={item.href} exact={item.exact}>
                  <span className="inline-flex items-center gap-2">
                    {(() => {
                      const Icon = IconFor(item.icon);
                      return Icon ? <Icon className="size-4" /> : null;
                    })()}
                    <span>{item.label}</span>
                  </span>
                </ActiveLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div>
        <ul className="flex items-center gap-x-1.5 [&_li[data-fade]:hover]:opacity-100 [&_li[data-fade]]:opacity-60">
          <li data-fade>
            <div className="lg:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ToggleMenuButton />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {visibleMenu.map(item => (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href} className="flex items-center gap-2">
                        {(() => {
                          const Icon = IconFor(item.icon);
                          return Icon ? <Icon className="size-4" /> : null;
                        })()}
                        <span>{item.label}</span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>

          {/* PRO: Dark mode toggle button */}

          <li data-fade>
            <ThemeToggleButton />
          </li>

          <li data-fade>
            <LocaleSwitcher />
          </li>

          <li>
            <Separator orientation="vertical" className="h-4" />
          </li>

          <li>
            <UserButton
              userProfileMode="navigation"
              userProfileUrl="/dashboard/settings/account"
              appearance={{
                elements: {
                  rootBox: 'px-2 py-1.5',
                },
              }}
            />
          </li>
        </ul>
      </div>
    </>
  );
};
