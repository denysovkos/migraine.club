import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSignInPath, requireUserOrRedirect } from './AuthGuard';

const authMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  // next/navigation's redirect() throws to abort rendering.
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }));

describe('AuthGuard', () => {
  beforeEach(() => {
    authMock.mockReset();
    redirectMock.mockClear();
  });

  describe('getSignInPath', () => {
    it('has no prefix for the default locale', () => {
      expect(getSignInPath('en')).toBe('/sign-in');
    });

    it('prefixes other locales', () => {
      expect(getSignInPath('uk')).toBe('/uk/sign-in');
      expect(getSignInPath('fr')).toBe('/fr/sign-in');
    });
  });

  describe('requireUserOrRedirect', () => {
    it('returns the user id when signed in', async () => {
      authMock.mockResolvedValue({ userId: 'user_123' });

      await expect(requireUserOrRedirect('en')).resolves.toBe('user_123');

      expect(redirectMock).not.toHaveBeenCalled();
    });

    it('redirects signed-out visitors to the localized sign-in page', async () => {
      authMock.mockResolvedValue({ userId: null });

      await expect(requireUserOrRedirect('uk')).rejects.toThrow('NEXT_REDIRECT:/uk/sign-in');

      expect(redirectMock).toHaveBeenCalledWith('/uk/sign-in');
    });
  });
});
