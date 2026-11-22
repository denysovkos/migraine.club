/**
 * Clinician report preview (HTML). Regression: the cycle timeline queried
 * date columns with JS Dates of local midnight, which serialize to the
 * previous UTC day for zones east of UTC (the seeded user is Europe/Kyiv), so
 * the last day of the range never showed its bleeding or migraine.
 */

import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

const config = (c: unknown) => `/api/reports/clinician/preview?config=${encodeURIComponent(JSON.stringify(c))}`;

test.describe('clinician report preview', () => {
  test('shows the cycle timeline through the last day of the range', async ({ page }) => {
    await query(`delete from cycle_settings where user_id = $1`, [E2E_USER_ID]);
    await query(`delete from cycle_bleeding_day where user_id = $1`, [E2E_USER_ID]);
    await query(`delete from daily_diary_entry where user_id = $1 and local_date between '2026-01-29' and '2026-01-31'`, [E2E_USER_ID]);
    await query(
      `insert into cycle_settings (user_id, enabled, include_in_exports) values ($1, true, true)`,
      [E2E_USER_ID],
    );
    await query(
      `insert into cycle_bleeding_day (user_id, local_date, bleeding, flow, source) values ($1, '2026-01-30', true, 'medium', 'user'), ($1, '2026-01-31', true, 'medium', 'user')`,
      [E2E_USER_ID],
    );
    await query(
      `insert into daily_diary_entry (user_id, local_date, timezone, day_type) values ($1, '2026-01-31', 'Europe/Kyiv', 'migraine_day')`,
      [E2E_USER_ID],
    );

    const res = await page.request.get(config({ template: 'full', rangePreset: 'custom', from: '2026-01-01', to: '2026-01-31' }));

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('text/html; charset=utf-8');

    const html = await res.text();

    expect(html).toContain('<tr><td>2026-01-30</td><td>Yes</td><td>No</td></tr>');
    expect(html).toContain('<tr><td>2026-01-31</td><td>Yes</td><td>Yes</td></tr>');
  });

  test('rejects malformed config', async ({ page }) => {
    const bad = await page.request.get('/api/reports/clinician/preview?config=%7Bbad');

    expect(bad.status()).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Invalid config JSON' });

    const invalid = await page.request.get(config({ rangePreset: 'custom' }));

    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error).toBe('Invalid config');
  });

  test('does not leak another user\'s appointment prep', async ({ page }) => {
    await query(`delete from appointment_prep where id = 'eeeeeeee-0000-4000-8000-000000000001'`);
    await query(
      `insert into appointment_prep (id, user_id, appointment_date, visit_label, generated_snapshot) values ('eeeeeeee-0000-4000-8000-000000000001', 'someone_else', '2030-01-01', 'Private visit', '{}')`,
    );

    const res = await page.request.get(config({ appointmentPrepId: 'eeeeeeee-0000-4000-8000-000000000001' }));
    const html = await res.text();

    expect(res.status()).toBe(200);
    expect(html).not.toContain('Private visit');
  });
});
