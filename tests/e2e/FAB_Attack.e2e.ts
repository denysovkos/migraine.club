import { expect, test } from './_fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('FAB → Log attack navigates to new episode page', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  await page.getByRole('button', { name: 'Quick log' }).click();

  await expect(page.getByRole('heading', { name: 'Quick log' })).toBeVisible();

  await page.getByRole('button', { name: /^Log attack/ }).click();

  await page.waitForURL(/\/(en\/)?dashboard\/episodes\/new/);
});
