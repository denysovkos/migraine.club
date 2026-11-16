import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUserProfileContextMock = vi.fn();
const setThemeMock = vi.fn();

vi.mock('next-themes', () => ({
  useTheme: () => ({
    setTheme: setThemeMock,
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'theme_toggle_label') {
      return 'Dark mode';
    }
    return key;
  },
}));

vi.mock('@/features/auth/UserProfileProvider', () => ({
  useUserProfileContext: useUserProfileContextMock,
}));

describe('ThemeToggleButton', () => {
  beforeEach(() => {
    setThemeMock.mockReset();
    const updateThemePreferenceMock = vi.fn().mockResolvedValue(true);
    useUserProfileContextMock.mockReturnValue({
      themePreference: 'light',
      updateThemePreference: updateThemePreferenceMock,
    });
  });

  it('switches from light to dark and persists the new preference', async () => {
    const user = userEvent.setup();
    const { ThemeToggleButton } = await import('./ThemeToggleButton');

    render(<ThemeToggleButton />);

    await user.click(screen.getByRole('switch', { name: /dark mode/i }));

    expect(setThemeMock).toHaveBeenCalledWith('dark');
    expect(useUserProfileContextMock.mock.results[0]?.value.updateThemePreference).toHaveBeenCalledWith('dark');
  });

  it('reverts to the previous theme when persistence fails', async () => {
    const user = userEvent.setup();
    const updateThemePreferenceMock = vi.fn().mockResolvedValue(false);
    useUserProfileContextMock.mockReturnValue({
      themePreference: 'light',
      updateThemePreference: updateThemePreferenceMock,
    });

    const { ThemeToggleButton } = await import('./ThemeToggleButton');

    render(<ThemeToggleButton />);

    await user.click(screen.getByRole('switch', { name: /dark mode/i }));

    expect(setThemeMock).toHaveBeenNthCalledWith(1, 'dark');
    expect(setThemeMock).toHaveBeenNthCalledWith(2, 'light');
    expect(updateThemePreferenceMock).toHaveBeenCalledWith('dark');
  });
});
