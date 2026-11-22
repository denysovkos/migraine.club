import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

const OTHER_USER_ID = 'e2e_alerts_other_user';

async function alertsEnabled(userId: string): Promise<boolean | undefined> {
  const [row] = await query<{ a: boolean }>('SELECT alerts_enabled AS a FROM user_weather_settings WHERE user_id = $1', [userId]);
  return row?.a;
}

test.describe('daily risk alerts', () => {
  test.afterEach(async () => {
    await query('DELETE FROM user_weather_settings WHERE user_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM "user" WHERE id = $1', [OTHER_USER_ID]);
  });

  // The settings UI shows this toggle only once push notifications are set up
  // on the device, which the e2e browser cannot do, so the flow is driven
  // through the API the toggle calls.
  test('user turns alerts on and off; the choice persists', async ({ page }) => {
    expect(await (await page.request.get('/api/user/alerts')).json()).toEqual({
      alertsEnabled: false,
      hasLocation: true,
      timezone: 'Europe/Kyiv',
    });

    const on = await page.request.put('/api/user/alerts', { data: { alertsEnabled: true } });

    expect(await on.json()).toEqual({ ok: true, alertsEnabled: true });
    expect(await alertsEnabled(E2E_USER_ID)).toBe(true);
    expect((await (await page.request.get('/api/user/alerts')).json()).alertsEnabled).toBe(true);

    await page.request.put('/api/user/alerts', { data: { alertsEnabled: false } });

    expect(await alertsEnabled(E2E_USER_ID)).toBe(false);
  });

  test('API validates the body and requires a saved location', async ({ page }) => {
    const bad = await page.request.put('/api/user/alerts', { data: { alertsEnabled: 'yes' } });

    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe('Invalid request');

    await query('DELETE FROM user_weather_settings WHERE user_id = $1', [E2E_USER_ID]);

    const get = await page.request.get('/api/user/alerts');

    expect(await get.json()).toEqual({ alertsEnabled: false, hasLocation: false, timezone: null });

    const put = await page.request.put('/api/user/alerts', { data: { alertsEnabled: true } });

    expect(put.status()).toBe(400);
    expect((await put.json()).error).toBe('Location not configured. Please set up your location first.');
  });

  test('one user never sees or changes another user\'s alert setting', async ({ page }) => {
    await query('INSERT INTO "user" (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [OTHER_USER_ID, 'Other']);
    await query(
      `INSERT INTO user_weather_settings (user_id, lat, lon, timezone, alerts_enabled)
       VALUES ($1, 48.85, 2.35, 'Europe/Paris', true)`,
      [OTHER_USER_ID],
    );

    const own = await (await page.request.get('/api/user/alerts')).json();

    expect(own).toEqual({ alertsEnabled: false, hasLocation: true, timezone: 'Europe/Kyiv' });

    await page.request.put('/api/user/alerts', { data: { alertsEnabled: true } });
    await page.request.put('/api/user/alerts', { data: { alertsEnabled: false } });

    expect(await alertsEnabled(OTHER_USER_ID)).toBe(true);
  });
});
