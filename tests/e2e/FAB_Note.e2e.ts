import { expect, test } from './_fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('FAB → Add today\'s note saves a note', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  // A diary entry for today must exist before a note can attach to it
  // (the upsert endpoint requires dayType when creating a new entry).
  // Tap "No pain" in the hero card to create today's entry.
  await page.getByLabel('Today check-in').getByRole('button', { name: 'No pain', exact: true }).click();

  await expect(page.getByLabel('Today check-in').getByText('No pain', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Quick log' }).click();

  await expect(page.getByRole('heading', { name: 'Quick log' })).toBeVisible();

  await page.getByRole('button', { name: /Add today's note/ }).click();

  await expect(page.getByRole('heading', { name: 'Add a note' })).toBeVisible();

  // Wait for the modal to finish fetching today's diary (Save stays disabled
  // until then; clicking too early silently no-ops).
  const textarea = page.getByPlaceholder('What\'s on your mind?');

  await expect(textarea).toBeEnabled({ timeout: 10_000 });

  await textarea.fill('Hello e2e world');

  const saveBtn = page.getByRole('button', { name: 'Save note' });

  await expect(saveBtn).toBeEnabled();

  await saveBtn.click();

  await expect(page.getByText('Note saved')).toBeVisible({ timeout: 10_000 });
});
