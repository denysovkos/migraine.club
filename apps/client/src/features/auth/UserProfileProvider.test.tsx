import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserProfileProvider } from './UserProfileProvider';

const nav = vi.hoisted(() => ({ pathname: '/dashboard', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}));

const clerk = vi.hoisted(() => ({ user: { id: 'user_1' } as { id: string } }));
vi.mock('@clerk/nextjs', () => ({
  // Clerk hands out a new user object whenever its session refreshes.
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: { ...clerk.user } }),
}));

function profile(preferredLanguage: string) {
  return { id: 'user_1', displayName: 'Pat', preferredLanguage, themePreference: 'light', isDoctor: false, isDoctorVerified: false, createdAt: '', updatedAt: '' };
}

describe('UserProfileProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nav.pathname = '/dashboard';
    nav.replace.mockReset();
    fetchMock = vi.fn(async () => new Response(JSON.stringify(profile('en'))));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // It refetched on every page change (and every Clerk session refresh).
  it('fetches the profile once per user, not on every page', async () => {
    const view = render(<UserProfileProvider currentLocale="en"><p>page</p></UserProfileProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    nav.pathname = '/dashboard/diary';
    view.rerender(<UserProfileProvider currentLocale="en"><p>diary</p></UserProfileProvider>);
    nav.pathname = '/dashboard/settings';
    view.rerender(<UserProfileProvider currentLocale="en"><p>settings</p></UserProfileProvider>);
    await new Promise(r => setTimeout(r, 20));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('still moves the user to their preferred locale, once', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(profile('fr'))));
    const view = render(<UserProfileProvider currentLocale="en"><p>page</p></UserProfileProvider>);

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/fr/dashboard'));

    nav.pathname = '/dashboard/diary';
    view.rerender(<UserProfileProvider currentLocale="en"><p>diary</p></UserProfileProvider>);
    await new Promise(r => setTimeout(r, 20));

    expect(nav.replace).toHaveBeenCalledTimes(1);
  });
});
