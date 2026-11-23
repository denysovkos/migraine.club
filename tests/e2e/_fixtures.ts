/**
 * Playwright fixtures for mock-auth e2e tests.
 *
 * The server is launched with `E2E_MOCK_AUTH=true` (see playwright.config.ts),
 * which signs every request in as the e2e user (internal/auth Mock), and the
 * SPA is built with the same flag, which swaps Clerk for src/libs/MockClerk.tsx
 * (web/aliases.ts).
 *
 * Each test gets a fresh DB state via the `seeded` fixture, which runs
 * `e2e:reset` then `e2e:seed` once per test. Disable by overriding the fixture.
 */

import { execSync } from 'node:child_process';
import { test as base, expect } from '@playwright/test';

type SeedFixtures = {
  seeded: void;
  dismissCookies: void;
  failureDiagnostics: void;
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
  // CI artifacts (traces, videos) are not always reachable, so when a test
  // fails, print what the browser saw into the job log: console output,
  // failed requests, and connectivity / service-worker state of open pages.
  failureDiagnostics: [
    async ({ context }, use, testInfo) => {
      const events: string[] = [];
      const started = Date.now();
      const stamp = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`;
      const watch = (page: import('@playwright/test').Page) => {
        page.on('console', (msg) => {
          if (msg.type() === 'error' || msg.type() === 'warning') {
            events.push(`${stamp()} console.${msg.type()}: ${msg.text()}`);
          }
        });
        page.on('pageerror', err => events.push(`${stamp()} pageerror: ${err.message}`));
        page.on('requestfailed', req =>
          events.push(`${stamp()} requestfailed: ${req.method()} ${new URL(req.url()).pathname} (${req.failure()?.errorText})`));
      };
      context.pages().forEach(watch);
      context.on('page', watch);

      await use();

      if (testInfo.status === testInfo.expectedStatus) {
        return;
      }
      const state: string[] = [];
      for (const page of context.pages()) {
        try {
          const info = await page.evaluate(async () => ({
            url: location.pathname,
            onLine: navigator.onLine,
            swControlled: !!navigator.serviceWorker?.controller,
            syncUi: Array.from(document.querySelectorAll('button'))
              .map(b => b.textContent?.trim() ?? '')
              .filter(t => /sync/i.test(t)),
          }));
          state.push(JSON.stringify(info));
        } catch (err) {
          state.push(`page state unavailable: ${(err as Error).message}`);
        }
      }
      console.warn([
        `[e2e diagnostics] ${testInfo.titlePath.join(' > ')} (${testInfo.project.name})`,
        ...state.map(s => `  page: ${s}`),
        ...events.slice(-60).map(e => `  ${e}`),
      ].join('\n'));
    },
    { auto: true },
  ],
});

export { expect };
