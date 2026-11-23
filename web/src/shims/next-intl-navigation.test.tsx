import { act, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { createNavigation } from './next-intl-navigation';

const { usePathname, useRouter } = createNavigation({ locales: ['en', 'fr', 'uk'], defaultLocale: 'en' });

type Api = { router: ReturnType<typeof useRouter>; pathname: string };

function setup(start: string) {
  const api = {} as Api;
  function Probe() {
    api.router = useRouter();
    api.pathname = usePathname();
    return null;
  }
  const router = createMemoryRouter([{ path: '*', Component: Probe }], { initialEntries: [start] });
  render(<RouterProvider router={router} />);
  return { api, location: () => router.state.location.pathname };
}

afterEach(() => {
  document.cookie = 'NEXT_LOCALE=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('next-intl navigation', () => {
  it('strips the locale prefix from usePathname', () => {
    const { api } = setup('/fr/dashboard/diary');

    expect(api.pathname).toBe('/dashboard/diary');
  });

  it('keeps the current locale on push', () => {
    document.cookie = 'NEXT_LOCALE=fr; path=/';
    const { api, location } = setup('/fr/dashboard');

    act(() => api.router.push('/dashboard/diary'));

    expect(location()).toBe('/fr/dashboard/diary');
  });

  it('switches locale: writes the cookie and lands on the new prefix', () => {
    document.cookie = 'NEXT_LOCALE=fr; path=/';
    const { api, location } = setup('/fr/dashboard');

    act(() => api.router.replace('/dashboard', { locale: 'uk' }));

    expect(document.cookie).toBe('NEXT_LOCALE=uk');
    expect(location()).toBe('/uk/dashboard');
  });

  it('switching to the default locale drops the prefix', () => {
    document.cookie = 'NEXT_LOCALE=uk; path=/';
    const { api, location } = setup('/uk/dashboard');

    act(() => api.router.push('/dashboard', { locale: 'en' }));

    expect(location()).toBe('/dashboard');
  });
});
