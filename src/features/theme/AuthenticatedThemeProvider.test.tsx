import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTheme } from 'next-themes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useUserProfileContextMock = vi.fn();

function ThemeToggleProbe() {
  const { setTheme } = useTheme();

  return (
    <button type="button" onClick={() => setTheme('dark')}>
      go dark
    </button>
  );
}

vi.mock('@/features/auth/UserProfileProvider', () => ({
  useUserProfileContext: useUserProfileContextMock,
}));

describe('AuthenticatedThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    useUserProfileContextMock.mockReturnValue({
      themePreference: 'dark',
    });
  });

  afterEach(() => {
    document.documentElement.className = '';
  });

  it('applies the saved dark theme to the document element', async () => {
    const { AuthenticatedThemeProvider } = await import('./AuthenticatedThemeProvider');

    render(
      <AuthenticatedThemeProvider>
        <div>theme child</div>
      </AuthenticatedThemeProvider>,
    );

    expect(screen.getByText('theme child')).toBeInTheDocument();

    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark');
    });
  });

  it('does not revert a theme change back to the saved preference', async () => {
    useUserProfileContextMock.mockReturnValue({ themePreference: 'light' });
    const user = userEvent.setup();
    const { AuthenticatedThemeProvider } = await import('./AuthenticatedThemeProvider');

    render(
      <AuthenticatedThemeProvider>
        <ThemeToggleProbe />
      </AuthenticatedThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement).toHaveClass('light');
    });

    await user.click(screen.getByRole('button', { name: 'go dark' }));

    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark');
    });

    // The synchronizer effect re-runs whenever `setTheme` changes identity; it
    // must not re-apply the stale saved preference and undo the toggle.
    expect(document.documentElement).not.toHaveClass('light');
  });
});
