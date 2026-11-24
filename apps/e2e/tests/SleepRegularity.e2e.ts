import { expect, test } from './_fixtures';

test('tapping On target shows the computed sleep duration', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  // Locate the Sleep regularity card by its title.
  await expect(page.getByRole('heading', { name: 'Last night' })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'On target', exact: true }).click();

  // Target is 23:00-07:00 → "8h 00m" duration label appears in the card.
  await expect(page.getByText(/^\d+h \d{2}m$/).first()).toBeVisible({ timeout: 10_000 });
});
