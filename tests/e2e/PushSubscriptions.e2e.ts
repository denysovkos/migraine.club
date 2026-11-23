import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

const OTHER_USER_ID = 'e2e_push_other_user';
const keys = { p256dh: 'BGGMAS8DUjSPoek9Mg4qH9GHwBOZF6CNMS_dpYCBelt1g8zcexample', auth: 'cdy0PYUyd7hjhQZ3dkAj3w' };

// Browsers in CI cannot grant push permission, so the flow the settings page
// drives is exercised through the same API calls.
test.describe('push subscriptions', () => {
  test.afterEach(async () => {
    await query('DELETE FROM push_subscription WHERE user_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM "user" WHERE id = $1', [OTHER_USER_ID]);
  });

  test('a device subscribes, re-subscribes and unsubscribes', async ({ page }) => {
    const endpoint = 'https://push.example.test/device-1';
    const first = await page.request.post('/api/push/subscribe', { data: { endpoint, keys, expirationTime: null }, headers: { 'user-agent': 'E2E/1' } });

    expect(first.status()).toBe(200);

    const { subscriptionId } = await first.json();
    const again = await (await page.request.post('/api/push/subscribe', { data: { endpoint, keys } })).json();

    expect(again).toEqual({ ok: true, subscriptionId });

    const rows = await query<{ user_id: string; user_agent: string | null }>('SELECT user_id, user_agent FROM push_subscription WHERE endpoint = $1', [endpoint]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(E2E_USER_ID);

    const removed = await (await page.request.post('/api/push/unsubscribe', { data: { endpoint } })).json();

    expect(removed).toEqual({ ok: true, deletedCount: 1 });
  });

  test('validates input and reports when push is not configured', async ({ page }) => {
    const bad = await page.request.post('/api/push/subscribe', { data: { endpoint: 'nope', keys: { p256dh: '', auth: '' } } });

    expect(bad.status()).toBe(400);
    expect(Object.keys((await bad.json()).details)).toEqual(['endpoint', 'keys']);

    const tested = await page.request.post('/api/push/test');

    expect([200, 503]).toContain(tested.status());
  });

  test('unsubscribing never removes another user\'s device', async ({ page }) => {
    await query('INSERT INTO "user" (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [OTHER_USER_ID, 'Other']);
    await query(
      `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth) VALUES ($1, 'https://push.example.test/other', 'k', 'a')`,
      [OTHER_USER_ID],
    );

    const res = await (await page.request.post('/api/push/unsubscribe', { data: { endpoint: 'https://push.example.test/other' } })).json();

    expect(res.deletedCount).toBe(0);

    const left = await query('SELECT 1 FROM push_subscription WHERE user_id = $1', [OTHER_USER_ID]);

    expect(left).toHaveLength(1);
  });
});
