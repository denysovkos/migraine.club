import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { profileMock, updateProfileMock, refetchMock, setThemePreferencePreviewMock } = vi.hoisted(() => ({
  profileMock: {
    id: 'user-1',
    displayName: 'Ada',
    preferredLanguage: 'en',
    themePreference: 'dark',
    isDoctor: false,
    isDoctorVerified: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  updateProfileMock: vi.fn().mockResolvedValue(true),
  refetchMock: vi.fn(),
  setThemePreferencePreviewMock: vi.fn(),
}));

const setThemeMock = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({
    setTheme: setThemeMock,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/features/auth/UserProfileProvider', () => ({
  useUserProfileContext: () => ({
    themePreference: profileMock.themePreference,
    refetch: refetchMock,
    setThemePreferencePreview: setThemePreferencePreviewMock,
  }),
}));

vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => ({
    profile: profileMock,
    loading: false,
    error: null,
    updateProfile: updateProfileMock,
    refetch: refetchMock,
  }),
}));

describe('ProfileSettingsForm', () => {
  beforeEach(() => {
    updateProfileMock.mockClear();
    refetchMock.mockClear();
    setThemeMock.mockClear();
    setThemePreferencePreviewMock.mockClear();
  });

  it('renders a theme preference section with light and dark choices', async () => {
    const { ProfileSettingsForm } = await import('./ProfileSettingsForm');

    render(<ProfileSettingsForm />);

    expect(screen.getByText('theme_label')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'theme_light' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'theme_dark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'theme_dark' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('submits the selected theme preference with the profile update', async () => {
    const user = userEvent.setup();
    const { ProfileSettingsForm } = await import('./ProfileSettingsForm');

    render(<ProfileSettingsForm />);

    await user.click(screen.getByRole('button', { name: 'theme_light' }));
    await user.click(screen.getByRole('button', { name: 'save_button' }));

    expect(updateProfileMock).toHaveBeenCalledWith({
      displayName: 'Ada',
      preferredLanguage: 'en',
      themePreference: 'light',
    });
  });

  it('applies the selected theme immediately before saving', async () => {
    const user = userEvent.setup();
    const { ProfileSettingsForm } = await import('./ProfileSettingsForm');

    render(<ProfileSettingsForm />);

    await user.click(screen.getByRole('button', { name: 'theme_light' }));

    expect(setThemePreferencePreviewMock).toHaveBeenCalledWith('light');
    expect(setThemeMock).toHaveBeenCalledWith('light');
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it('applies the saved theme to the current session after a successful theme change', async () => {
    const user = userEvent.setup();
    const { ProfileSettingsForm } = await import('./ProfileSettingsForm');

    render(<ProfileSettingsForm />);

    await user.click(screen.getByRole('button', { name: 'theme_light' }));
    await user.click(screen.getByRole('button', { name: 'save_button' }));

    expect(setThemeMock).toHaveBeenCalledWith('light');
    expect(refetchMock).toHaveBeenCalled();
  });
});
