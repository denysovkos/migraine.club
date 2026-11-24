import { expect, test } from './_fixtures';

test('diary page renders current month and day cells', async ({ page }) => {
  await page.goto('/en/dashboard/diary');

  // Month title format: "May 2026" — luxon `toLocaleString({ month: 'long', year: 'numeric' })`.
  // The label sits between the prev/next month buttons in the calendar header.
  await expect(page.getByText(/^[A-Z][a-z]+ \d{4}$/).first()).toBeVisible({ timeout: 10_000 });

  // Day cells are buttons with aria-label = "YYYY-MM-DD". Wait for the calendar
  // grid to hydrate, then count via DOM attribute (regex-by-role is unreliable
  // for date-shaped accessible names).
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button[aria-label]'));
    return buttons.filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.getAttribute('aria-label') ?? '')).length >= 28;
  }, undefined, { timeout: 10_000 });

  const dayCount = await page.locator('button[aria-label]').evaluateAll(els =>
    els.filter(el => /^\d{4}-\d{2}-\d{2}$/.test(el.getAttribute('aria-label') ?? '')).length,
  );

  expect(dayCount).toBeGreaterThanOrEqual(28);
});
