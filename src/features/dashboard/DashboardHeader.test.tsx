import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs', () => ({
  UserButton: () => <div>user-button</div>,
}));

vi.mock('@/components/ActiveLink', () => ({
  ActiveLink: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/LocaleSwitcher', () => ({
  LocaleSwitcher: () => <div>locale-switcher</div>,
}));

vi.mock('@/components/ToggleMenuButton', () => ({
  ToggleMenuButton: () => <button type="button">menu-toggle</button>,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <div>separator</div>,
}));

vi.mock('@/hooks/useModeration', () => ({
  useUserRole: () => ({
    isModerator: false,
    isAdmin: false,
  }),
}));

vi.mock('@/templates/Logo', () => ({
  Logo: () => <div>logo</div>,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/features/theme/ThemeToggleButton', () => ({
  ThemeToggleButton: () => <button type="button">theme-toggle</button>,
}));

describe('DashboardHeader', () => {
  it('renders the theme toggle in the top header action area', async () => {
    const { DashboardHeader } = await import('./DashboardHeader');

    render(
      <DashboardHeader
        menu={[
          { href: '/dashboard', label: 'Dashboard', exact: true, icon: 'dashboard' },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'theme-toggle' })).toBeInTheDocument();
  });
});
