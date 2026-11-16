import { expect, test } from './_fixtures';

test('tapping Log on Topiramate row changes button to Logged', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  // Find the row containing the seeded med name
  const row = page.getByRole('listitem').filter({ hasText: 'Topiramate (E2E)' }).first();

  await expect(row).toBeVisible({ timeout: 10_000 });

  const logBtn = row.getByRole('button', { name: 'Log', exact: true });
  await logBtn.click();

  await expect(row.getByRole('button', { name: /Logged/ })).toBeVisible({ timeout: 5_000 });
});
