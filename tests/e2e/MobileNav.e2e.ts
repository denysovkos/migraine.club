import { expect, test } from './_fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('mobile bottom nav has 5 items and More opens the menu', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  await expect(page.locator('nav.mc-bn-blur li')).toHaveCount(5);

  await page.getByRole('button', { name: 'More menu' }).click();

  await expect(page.getByRole('heading', { name: 'All sections' })).toBeVisible();
});
