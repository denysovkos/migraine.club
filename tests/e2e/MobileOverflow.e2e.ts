import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function getHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0);
    return { innerWidth: w, scrollWidth, overflowPx: Math.max(0, scrollWidth - w) };
  });
}

test.describe('Mobile-first layout', () => {
  const routes = [
    '/',
    '/product',
    '/privacy',
    '/terms',
    '/sign-in',
    // Auth-required routes should still not overflow (usually redirect to sign-in).
    '/dashboard',
    '/dashboard/settings',
  ];

  function defineViewportSuite(vp: { width: number; height: number; name: string }) {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('key pages should not overflow horizontally', async ({ page }) => {
      for (const route of routes) {
        await page.goto(route);
        await page.waitForLoadState('domcontentloaded');

        const m = await getHorizontalOverflow(page);

        expect(
          m.scrollWidth,
          `Horizontal overflow on ${route} @ ${vp.name}: scrollWidth=${m.scrollWidth}, innerWidth=${m.innerWidth}, overflowPx=${m.overflowPx}`,
        ).toBeLessThanOrEqual(m.innerWidth);
      }
    });
  }

  test.describe('390x844', () => {
    defineViewportSuite({ width: 390, height: 844, name: '390x844' });
  });

  test.describe('320x700', () => {
    defineViewportSuite({ width: 320, height: 700, name: '320x700' });
  });
});
