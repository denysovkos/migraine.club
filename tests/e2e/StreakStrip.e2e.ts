import { expect, test } from './_fixtures';

test.describe('Streak strip responsive cell count', () => {
  test('mobile shows 7 cells', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/dashboard');

    await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

    // Wait until the strip is hydrated (no longer skeleton-only)
    await page.waitForFunction(() => document.querySelectorAll('.mc-streak-day').length === 14);
    const visible = page.locator('.mc-streak-day:visible');

    await expect(visible).toHaveCount(7);
  });

  test('desktop shows 14 cells', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/dashboard');

    await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

    await page.waitForFunction(() => document.querySelectorAll('.mc-streak-day').length === 14);
    const visible = page.locator('.mc-streak-day:visible');

    await expect(visible).toHaveCount(14);
  });
});
