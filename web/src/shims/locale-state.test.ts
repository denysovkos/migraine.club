import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localeOfPath, middlewareHref, setLocaleCookie } from './locale-state';

function clearCookies() {
  for (const c of document.cookie.split('; ').filter(Boolean)) {
    document.cookie = `${c.split('=')[0]}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

function languages(list: string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(list);
}

describe('localeOfPath', () => {
  it('reads a non-default prefix', () => {
    expect(localeOfPath('/fr/dashboard')).toBe('fr');
    expect(localeOfPath('/uk')).toBe('uk');
  });

  it('treats unprefixed and /en paths as the default locale', () => {
    expect(localeOfPath('/dashboard')).toBe('en');
    expect(localeOfPath('/en/dashboard')).toBe('en');
    expect(localeOfPath('/')).toBe('en');
  });
});

describe('middlewareHref', () => {
  beforeEach(() => {
    clearCookies();
    languages(['en-US']);
  });

  afterEach(() => {
    clearCookies();
    vi.restoreAllMocks();
  });

  it('keeps an unprefixed path for the default locale', () => {
    expect(middlewareHref('/dashboard')).toBe('/dashboard');
  });

  it('prefixes an unprefixed path with the cookie locale', () => {
    document.cookie = 'NEXT_LOCALE=fr; path=/';

    expect(middlewareHref('/dashboard/insights/report?x=1#top')).toBe('/fr/dashboard/insights/report?x=1#top');
  });

  it('prefixes the root without a trailing slash', () => {
    document.cookie = 'NEXT_LOCALE=uk; path=/';

    expect(middlewareHref('/')).toBe('/uk');
  });

  it('falls back to Accept-Language when there is no cookie', () => {
    languages(['uk-UA', 'en']);

    expect(middlewareHref('/dashboard')).toBe('/uk/dashboard');
  });

  it('follows the redirect chain with the cookie unchanged, as a fetch did', () => {
    // /en/x -> /x (default prefix dropped) -> /uk/x (cookie locale).
    document.cookie = 'NEXT_LOCALE=uk; path=/';

    expect(middlewareHref('/en/dashboard/diary')).toBe('/uk/dashboard/diary');
    expect(document.cookie).toBe('NEXT_LOCALE=uk');
  });

  it('drops the default prefix when the cookie agrees', () => {
    document.cookie = 'NEXT_LOCALE=en; path=/';

    expect(middlewareHref('/en/dashboard?a=1')).toBe('/dashboard?a=1');
  });

  it('keeps an explicit prefix and leaves the cookie alone', () => {
    expect(middlewareHref('/fr/dashboard')).toBe('/fr/dashboard');
    expect(document.cookie).toBe('');
  });

  it('fixes the prefix case and keeps the rest of the path', () => {
    expect(middlewareHref('/FR//dashboard/')).toBe('/fr/dashboard');
  });

  it('leaves paths the middleware never saw alone', () => {
    document.cookie = 'NEXT_LOCALE=fr; path=/';

    for (const href of ['/api/episodes', '/admin/feature-requests', '/share/abc', '/icon.png', 'https://example.com/x']) {
      expect(middlewareHref(href)).toBe(href);
    }
  });

  it('ignores an unknown cookie value', () => {
    document.cookie = 'NEXT_LOCALE=de; path=/';

    expect(middlewareHref('/dashboard')).toBe('/dashboard');
  });
});

describe('setLocaleCookie', () => {
  afterEach(clearCookies);

  it('writes the cookie only when the locale changes', () => {
    setLocaleCookie('en', 'en');

    expect(document.cookie).toBe('');

    setLocaleCookie('en', 'uk');

    expect(document.cookie).toBe('NEXT_LOCALE=uk');
  });
});

describe('middlewareHref outside the browser', () => {
  it('returns the href unchanged', async () => {
    vi.stubGlobal('window', undefined);
    try {
      expect(middlewareHref('/dashboard/reports')).toBe('/dashboard/reports');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
