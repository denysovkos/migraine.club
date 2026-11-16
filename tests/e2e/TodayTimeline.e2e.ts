import { expect, test } from './_fixtures';

test('Today timeline renders with Now marker for user without active attack', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  // Title (seeded user has no ongoing attack → "Your day so far")
  await expect(page.getByRole('heading', { name: 'Your day so far' })).toBeVisible();

  // The "Now" marker (uppercase, in the Now line of the timeline)
  await expect(page.getByText('Now', { exact: true }).first()).toBeVisible();
});
