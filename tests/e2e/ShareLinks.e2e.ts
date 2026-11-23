import type { Page } from '@playwright/test';
import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

const SHARE_PATH = '/en/dashboard/share';
const OTHER_USER_ID = 'e2e_share_other_user';

async function createViaUi(page: Page, label: string) {
  await page.goto(SHARE_PATH);
  await page.getByRole('button', { name: 'Create New Link' }).click();
  await page.getByLabel('Link Label').fill(label);
  await page.getByLabel('Doctor Name').fill('Dr. Smith');
  await page.getByLabel('Your Display Name').fill('Pat');
  const created = page.waitForResponse(r => r.url().endsWith('/api/share') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Link' }).click();

  expect((await created).status()).toBe(200);

  const [row] = await query<{ id: string; token: string }>(
    'SELECT id, token FROM doctor_share_link WHERE user_id = $1 AND label = $2',
    [E2E_USER_ID, label],
  );
  return row!;
}

function card(page: Page, label: string) {
  return page.locator('div.rounded-lg.border').filter({ hasText: label });
}

test.describe('doctor share links', () => {
  test.afterEach(async () => {
    await query('DELETE FROM doctor_share_link WHERE user_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM "user" WHERE id = $1', [OTHER_USER_ID]);
  });

  test('patient creates a link, the doctor opens it, and the visit is counted', async ({ page, context }) => {
    const link = await createViaUi(page, 'Dr. Smith appointment');

    expect(link.token).toMatch(/^[\w-]{43}$/);
    await expect(card(page, 'Dr. Smith appointment').getByText('Active')).toBeVisible();

    const doctor = await context.newPage();
    await doctor.goto(`/share/${link.token}`);

    await expect(doctor.getByText('Migraine Report')).toBeVisible();
    await expect(doctor.getByText('Patient: Pat')).toBeVisible();

    const [row] = await query<{ access_count: number; last_accessed_at: Date | null }>(
      'SELECT access_count, last_accessed_at FROM doctor_share_link WHERE id = $1',
      [link.id],
    );

    expect(row!.access_count).toBeGreaterThanOrEqual(1);
    expect(row!.last_accessed_at).not.toBeNull();
  });

  test('a revoked link stops working', async ({ page, context }) => {
    const link = await createViaUi(page, 'Revoke me');
    page.once('dialog', dialog => dialog.accept());
    const revoked = page.waitForResponse(r => r.url().endsWith('/api/share') && r.request().method() === 'DELETE');
    await card(page, 'Revoke me').locator('button.text-destructive').click();

    expect(await (await revoked).json()).toEqual({ success: true });
    await expect(card(page, 'Revoke me').getByText('Revoked')).toBeVisible();

    const res = await page.request.get(`/api/share/${link.token}`);

    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: 'This link has been revoked', code: 'REVOKED' });

    const doctor = await context.newPage();
    await doctor.goto(`/share/${link.token}`);

    await expect(doctor.getByText('Link Revoked')).toBeVisible();
  });

  test('invalid, unknown and expired tokens are rejected', async ({ page }) => {
    const short = await page.request.get('/api/share/short');

    expect(short.status()).toBe(400);
    expect(await short.json()).toEqual({ error: 'Invalid token', code: 'INVALID_TOKEN' });

    const unknown = await page.request.get('/api/share/e2e_unknown_token_000000000000');

    expect(unknown.status()).toBe(404);

    await query(
      `INSERT INTO doctor_share_link (user_id, token, expires_at) VALUES ($1, 'e2e_expired_token_000000000000', now() - interval '1 hour')`,
      [E2E_USER_ID],
    );
    const expired = await page.request.get('/api/share/e2e_expired_token_000000000000');

    expect(expired.status()).toBe(403);
    expect((await expired.json()).code).toBe('EXPIRED');

    await page.goto('/share/e2e_unknown_token_000000000000');

    await expect(page.getByText('Invalid Link')).toBeVisible();
  });

  test('API validates new links', async ({ page }) => {
    const res = await page.request.post('/api/share', { data: { expiresInDays: 0, appointmentPrepId: 'x' } });

    expect(res.status()).toBe(400);

    const body = await res.json();

    expect(body.error).toBe('Invalid request data');
    expect(body.details.map((i: { path: string[] }) => i.path[0])).toEqual(['expiresInDays', 'appointmentPrepId']);

    const missing = await page.request.delete('/api/share', { data: {} });

    expect(missing.status()).toBe(400);
  });

  test('one user never sees or revokes another user\'s links', async ({ page }) => {
    await query('INSERT INTO "user" (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [OTHER_USER_ID, 'Other']);
    const [other] = await query<{ id: string }>(
      `INSERT INTO doctor_share_link (user_id, token, label, expires_at)
       VALUES ($1, 'e2e_other_user_token_0000000000', 'Other link', now() + interval '1 day') RETURNING id`,
      [OTHER_USER_ID],
    );

    const list = await (await page.request.get('/api/share')).json();

    expect(list.map((l: { label: string }) => l.label)).not.toContain('Other link');

    const res = await page.request.delete('/api/share', { data: { id: other!.id } });

    expect(res.status()).toBe(404);

    const [row] = await query<{ is_revoked: boolean }>('SELECT is_revoked FROM doctor_share_link WHERE id = $1', [other!.id]);

    expect(row!.is_revoked).toBe(false);
  });
});
