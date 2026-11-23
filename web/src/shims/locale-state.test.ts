import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localeOfPath, middlewareHref } from './locale-state';

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
    // next-intl only writes the cookie when it disagrees with the header.
    expect(document.cookie).not.toContain('NEXT_LOCALE');
  });

  it('stores the default locale when the browser sends no languages', () => {
    languages([]);

    expect(middlewareHref('/dashboard')).toBe('/dashboard');
    expect(document.cookie).toContain('NEXT_LOCALE=en');
  });

  it('drops the default locale prefix and stores the locale', () => {
    document.cookie = 'NEXT_LOCALE=fr; path=/';

    expect(middlewareHref('/en/dashboard')).toBe('/dashboard');
    expect(document.cookie).toContain('NEXT_LOCALE=en');
  });

  it('keeps an explicit prefix and switches the cookie to it', () => {
    expect(middlewareHref('/fr/dashboard')).toBe('/fr/dashboard');
    expect(document.cookie).toContain('NEXT_LOCALE=fr');
  });

  it('matches the prefix case-insensitively and normalises slashes', () => {
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
