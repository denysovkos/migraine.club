import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ value: '/dashboard' }));

vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const { CookieBanner } = await import('./CookieBanner');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  pathname.value = '/dashboard';
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderAndWait() {
  const view = render(<CookieBanner />);
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  return view;
}

describe('CookieBanner', () => {
  it('asks for a choice when none is stored', async () => {
    await renderAndWait();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('stays hidden once a choice is stored', async () => {
    localStorage.setItem('migrennity_cookie_prefs', JSON.stringify({ essential: true, analytics: false, timestamp: 1 }));
    await renderAndWait();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['/quick/attack', '/uk/quick/attack'])('waits until the user leaves attack mode (%s)', async (path) => {
    pathname.value = path;
    const { rerender } = await renderAndWait();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Nothing was decided for the user: analytics stay off until they choose.
    expect(localStorage.getItem('migrennity_cookie_prefs')).toBeNull();

    pathname.value = '/dashboard';
    rerender(<CookieBanner />);
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
