import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

const OTHER_USER_ID = 'e2e_feature_other_user';

test.describe('feature requests', () => {
  test.afterEach(async () => {
    await query('DELETE FROM feature_request WHERE user_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM "user" WHERE id = $1', [OTHER_USER_ID]);
  });

  test('user sends a request from settings and sees it listed', async ({ page }) => {
    await page.goto('/en/dashboard/settings/help');
    await page.getByLabel('Feature title').fill('Export trends');
    await page.getByLabel('What problem should this solve?').fill('I want to export my monthly trends.');
    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(page.getByText('Your request has been sent.')).toBeVisible();
    await expect(page.getByText('Export trends')).toBeVisible();

    const [row] = await query<{ resolution: string }>('SELECT resolution FROM feature_request WHERE user_id = $1', [E2E_USER_ID]);

    expect(row!.resolution).toBe('SENT');
  });

  test('limits active requests, validates input and keeps users apart', async ({ page }) => {
    await query('INSERT INTO "user" (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [OTHER_USER_ID, 'Other']);
    await query('INSERT INTO feature_request (user_id, title, description) VALUES ($1, $2, $3)', [OTHER_USER_ID, 'Theirs', 'Not visible to others']);

    const invalid = await page.request.post('/api/feature-requests', { data: { title: 'x', description: 'short' } });

    expect(invalid.status()).toBe(400);

    for (const title of ['One', 'Two', 'Three']) {
      expect((await page.request.post('/api/feature-requests', { data: { title: `${title} idea`, description: 'A long enough description' } })).status()).toBe(201);
    }
    const limit = await page.request.post('/api/feature-requests', { data: { title: 'Four idea', description: 'A long enough description' } });

    expect(limit.status()).toBe(409);
    expect((await limit.json()).code).toBe('ACTIVE_REQUEST_LIMIT_REACHED');

    const own = await (await page.request.get('/api/feature-requests')).json();

    expect(own.requests.map((r: { title: string }) => r.title)).not.toContain('Theirs');
    expect((await page.request.get('/api/admin/feature-requests')).status()).toBe(403);
  });
});
