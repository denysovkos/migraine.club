import { expect, test } from './_fixtures';

test('tapping Log on Topiramate row changes button to Logged', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  // The row in the preventives card. Once the dose is logged, today's
  // timeline above the card lists it too, so an unscoped first() match
  // would move to the timeline entry, which has no Log button.
  const card = page.locator('section').filter({ has: page.getByText('One tap to keep track', { exact: true }) });
  const row = card.getByRole('listitem').filter({ hasText: 'Topiramate (E2E)' });

  await expect(row).toBeVisible({ timeout: 10_000 });

  const logBtn = row.getByRole('button', { name: 'Log', exact: true });
  await logBtn.click();

  await expect(row.getByRole('button', { name: /Logged/ })).toBeVisible({ timeout: 5_000 });
});
