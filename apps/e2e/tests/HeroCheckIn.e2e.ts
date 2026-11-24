import { expect, test } from './_fixtures';

test.describe('Hero check-in segmented buttons', () => {
  test('tapping each option updates the pill', async ({ page }) => {
    await page.goto('/en/dashboard');

    await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

    const hero = page.getByLabel('Today check-in');

    // No pain → "No pain" pill
    await hero.getByRole('button', { name: 'No pain', exact: true }).click();

    await expect(hero.getByText('No pain', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // Headache → "Headache day" pill
    await hero.getByRole('button', { name: 'Headache', exact: true }).click();

    await expect(hero.getByText('Headache day', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Migraine → "Migraine day" pill
    await hero.getByRole('button', { name: 'Migraine', exact: true }).click();

    await expect(hero.getByText('Migraine day', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
