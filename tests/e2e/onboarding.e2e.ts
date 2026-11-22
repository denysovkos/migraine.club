/**
 * F43 baseline intake — end-to-end activation spec.
 *
 * This is the payoff test for the whole feature: a brand-new user (no
 * `intake_response` row) is gated into the wizard, answers all four steps,
 * and lands on a dashboard that already knows them — the medication they
 * named is pinned to Quick Kit, and a program is suggested with honest,
 * recall-phrased provenance ("You told us...").
 *
 * Uses its own minimal seed instead of the shared `seeded` fixture: the
 * default e2e-seed.ts creates active program enrollments for both
 * sleep-regularity and acute-med-timing, which would make
 * `rankRecommendations` treat them as already-enrolled and suppress the
 * suggestion this test exists to prove. See scripts/e2e-seed-onboarding.ts.
 */

import { execSync } from 'node:child_process';
import { E2E_USER_ID, query } from './_db';
import { test as base, expect } from './_fixtures';

const test = base.extend<{ seeded: void }>({
  seeded: [
    async ({}, use) => {
      execSync('npm run e2e:reset --silent', { stdio: 'inherit' });
      execSync('npm run e2e:seed:onboarding --silent', { stdio: 'inherit' });
      await use();
    },
    { auto: true },
  ],
});

test.describe('baseline intake', () => {
  test('new user completes intake and lands on a dashboard that already knows them', async ({ page }) => {
    await page.goto('/en/dashboard');

    // The gate redirects a user who has never been through intake.
    await expect(page).toHaveURL(/\/onboarding/);

    // Step 1 — frequency
    await page.getByText('4 to 7 a month').click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    // Step 2 — triggers
    await page.getByRole('button', { name: 'Stress' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    // Step 3 — medications: search the real catalog and pick the exact hit
    // (the catalog has many partial matches, e.g. "Dexibuprofen" and
    // "Ibuprofen, combinations" — exact match keeps this from picking the
    // wrong row).
    await page.getByPlaceholder('Search medications').fill('Ibuprofen');
    await page.getByRole('button', { name: 'Ibuprofen', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    // Step 4 — habits
    await page.getByRole('button', { name: 'Often' }).click();
    await page.getByRole('button', { name: 'More than 2 hours' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();

    await expect(page).toHaveURL(/\/dashboard/);

    // The payoff: the medication is already there to log with one tap
    // (Quick Kit pins the first few acute meds from intake).
    await expect(page.getByText('Ibuprofen')).toBeVisible();

    // And a program is suggested from the self-reported habits, with honest
    // provenance — recall, not observed data.
    await expect(page.getByText(/You told us/)).toBeVisible();

    // Re-entering the dashboard no longer redirects.
    await page.goto('/en/dashboard');

    await expect(page).toHaveURL(/\/dashboard/);
  });

  // Regression: completing with a custom trigger used to fail (500) because
  // the factor insert's ON CONFLICT could not use the partial unique index.
  test('a custom trigger named during intake becomes a factor', async ({ page }) => {
    await page.goto('/en/onboarding');

    await page.getByText('4 to 7 a month').click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    await page.getByPlaceholder('Add your own').fill('Red wine');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Finish' }).click();

    await expect(page).toHaveURL(/\/dashboard/);

    const factors = await query<{ display_name: string }>(
      `select display_name from factor where user_id = $1 and key = 'intake.trigger:red_wine'`,
      [E2E_USER_ID],
    );

    expect(factors).toEqual([{ display_name: 'Red wine' }]);

    const intake = await query<{ status: string }>(`select status from intake_response where user_id = $1`, [E2E_USER_ID]);

    expect(intake).toEqual([{ status: 'completed' }]);
  });
});
