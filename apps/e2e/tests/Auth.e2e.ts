import { expect, test } from './_fixtures';

test('dashboard renders signed-in for mocked user', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();
});
