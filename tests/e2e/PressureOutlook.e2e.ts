import { DateTime } from 'luxon';

import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

// Seeded by scripts/e2e-seed.ts: Kyiv location plus a cached 6-day pressure
// series with day-over-day changes of -, -2, -7, +3, -1, -7 hPa.
const OTHER_USER_ID = 'e2e_pressure_other_user';
const SETTINGS_PATH = '/en/dashboard/settings/location';

function kyivDay(offset: number): string {
  return DateTime.now().setZone('Europe/Kyiv').plus({ days: offset }).toISODate()!;
}

async function ownThreshold(): Promise<number | null> {
  const [row] = await query<{ t: number | null }>(
    'SELECT pressure_drop_threshold_hpa AS t FROM user_weather_settings WHERE user_id = $1',
    [E2E_USER_ID],
  );
  return row!.t;
}

test.describe('pressure-change outlook and alerts', () => {
  test.afterEach(async () => {
    await query('DELETE FROM user_weather_settings WHERE user_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM "user" WHERE id = $1', [OTHER_USER_ID]);
  });

  test('dashboard shows the multi-day outlook and highlights falls at the default threshold', async ({ page }) => {
    await page.goto('/en/dashboard');

    const card = page.getByTestId('pressure-outlook');

    await expect(card.getByRole('heading', { name: 'Pressure outlook' })).toBeVisible();
    await expect(card.getByText('Next 6 days · hPa')).toBeVisible();
    await expect(card.getByTestId(`pressure-day-${kyivDay(0)}`)).toContainText('Today');
    await expect(card.getByTestId(`pressure-day-${kyivDay(2)}`)).toHaveAttribute('data-drop', 'true');
    await expect(card.getByTestId(`pressure-day-${kyivDay(2)}`)).toContainText('-7.0');
    await expect(card.getByTestId(`pressure-day-${kyivDay(5)}`)).toHaveAttribute('data-drop', 'true');
    await expect(card.getByTestId(`pressure-day-${kyivDay(1)}`)).toHaveAttribute('data-drop', 'false');
    await expect(card.getByText('Context, not a prediction.', { exact: false })).toBeVisible();
    await expect(card.getByText('Pressure-drop alerts are off.')).toBeVisible();
  });

  test('user sets a threshold in settings; it persists and drives the outlook', async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    const select = page.getByLabel('Alert when pressure falls by');

    await expect(select).toHaveValue('off');

    await select.selectOption('8');

    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    expect(await ownThreshold()).toBe(8);

    await page.reload();

    await expect(page.getByLabel('Alert when pressure falls by')).toHaveValue('8');

    // A 7 hPa fall no longer meets an 8 hPa threshold.
    await page.goto('/en/dashboard');
    const card = page.getByTestId('pressure-outlook');

    await expect(card.getByText('Alert on: falls of 8 hPa or more in a day.')).toBeVisible();
    await expect(card.getByTestId(`pressure-day-${kyivDay(2)}`)).toHaveAttribute('data-drop', 'false');

    await page.goto(SETTINGS_PATH);
    await page.getByLabel('Alert when pressure falls by').selectOption('off');

    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    expect(await ownThreshold()).toBeNull();
  });

  test('API rejects invalid thresholds and leaves the setting unchanged', async ({ page }) => {
    await query('UPDATE user_weather_settings SET pressure_drop_threshold_hpa = 5 WHERE user_id = $1', [E2E_USER_ID]);

    for (const data of [{ thresholdHpa: 0 }, { thresholdHpa: 31 }, { thresholdHpa: 'five' }, {}]) {
      const res = await page.request.put('/api/user/pressure-alert', { data });

      expect(res.status(), JSON.stringify(data)).toBe(400);
    }

    expect(await ownThreshold()).toBe(5);

    const ok = await page.request.put('/api/user/pressure-alert', { data: { thresholdHpa: 3 } });

    expect(ok.status()).toBe(200);
    expect(await ownThreshold()).toBe(3);
  });

  test('one user never sees or changes another user\'s pressure settings', async ({ page }) => {
    await query(
      'INSERT INTO "user" (id, display_name, preferred_language) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [OTHER_USER_ID, 'Other', 'en'],
    );
    await query(
      `INSERT INTO user_weather_settings (user_id, lat, lon, timezone, pressure_drop_threshold_hpa)
       VALUES ($1, 48.85, 2.35, 'Europe/Paris', 3)`,
      [OTHER_USER_ID],
    );

    const settings = await page.request.get('/api/user/pressure-alert');

    expect(await settings.json()).toEqual({ hasLocation: true, thresholdHpa: null });

    const outlook = await (await page.request.get('/api/weather/pressure-outlook')).json();

    expect(outlook).toMatchObject({ timezone: 'Europe/Kyiv', alertThresholdHpa: null, highlightThresholdHpa: 5 });

    await page.request.put('/api/user/pressure-alert', { data: { thresholdHpa: 10 } });

    const [other] = await query<{ t: number }>(
      'SELECT pressure_drop_threshold_hpa AS t FROM user_weather_settings WHERE user_id = $1',
      [OTHER_USER_ID],
    );

    expect(other!.t).toBe(3);
    expect(await ownThreshold()).toBe(10);
  });

  test('without a saved location the outlook is hidden and alerts cannot be set', async ({ page }) => {
    await query('DELETE FROM user_weather_settings WHERE user_id = $1', [E2E_USER_ID]);

    expect((await page.request.get('/api/weather/pressure-outlook')).status()).toBe(404);
    expect((await page.request.put('/api/user/pressure-alert', { data: { thresholdHpa: 5 } })).status()).toBe(400);

    await page.goto('/en/dashboard');

    await expect(page.getByText('Configure your location', { exact: false })).toBeVisible();
    await expect(page.getByTestId('pressure-outlook')).toHaveCount(0);

    await page.goto(SETTINGS_PATH);

    await expect(page.getByText('Set your location above to use pressure-drop alerts.')).toBeVisible();
  });
});
