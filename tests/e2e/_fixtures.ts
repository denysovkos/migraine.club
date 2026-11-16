/**
 * Playwright fixtures for mock-auth e2e tests.
 *
 * The dev server is launched with `E2E_MOCK_AUTH=true` (see playwright.config.ts),
 * which:
 *   - swaps `@clerk/nextjs` and `@clerk/nextjs/server` for mock modules via webpack alias
 *   - makes `src/middleware.ts` stamp `x-e2e-mock-user` and skip Clerk
 *
 * Each test gets a fresh DB state via the `seeded` fixture, which runs
 * `e2e:reset` then `e2e:seed` once per test. Disable by overriding the fixture.
 */

import { execSync } from 'node:child_process';
import { test as base, expect } from '@playwright/test';

type SeedFixtures = {
  seeded: void;
  dismissCookies: void;
};

export const test = base.extend<SeedFixtures>({
  seeded: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      execSync('npm run e2e:reset --silent', { stdio: 'inherit' });
      execSync('npm run e2e:seed --silent', { stdio: 'inherit' });
      await use();
    },
    { auto: true },
  ],
  // Pre-accept cookie preferences so the bottom-fixed banner doesn't overlay
  // the FAB / bottom nav during interaction-heavy tests.
  dismissCookies: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        try {
          localStorage.setItem(
            'migrennity_cookie_prefs',
            JSON.stringify({ essential: true, analytics: false }),
          );
        } catch {
          // ignore (e.g. about:blank without storage)
        }
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect };
