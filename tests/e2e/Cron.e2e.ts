import { expect, test } from './_fixtures';

const JOBS = ['daily-risk', 'insights', 'medication-reminders', 'programs-reminders', 'solar-activity', 'stale-episode-reminder'];

// Cron routes are for the scheduler: a browser session never runs a job.
test.describe('cron endpoints', () => {
  for (const job of JOBS) {
    test(`${job} refuses requests without the cron secret`, async ({ page }) => {
      for (const method of ['get', 'post'] as const) {
        const res = await page.request[method](`/api/cron/${job}`, { headers: { 'x-cron-secret': 'not-the-secret' } });

        expect([401, 503]).toContain(res.status());

        const body = await res.json();

        expect(body.ok).toBeUndefined();
        expect(body.error).toMatch(/^(Unauthorized|Cron not configured)$/);
      }
    });
  }
});
