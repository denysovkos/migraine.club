import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

const PRIVACY_PATH = '/en/dashboard/settings/privacy';
const OTHER_USER_ID = 'e2e_delete_other_user';

async function count(sql: string, userId: string): Promise<number> {
  const [row] = await query<{ n: string }>(sql, [userId]);
  return Number(row!.n);
}

test.describe('account deletion', () => {
  test.beforeEach(async () => {
    await query('INSERT INTO "user" (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [OTHER_USER_ID, 'Other']);
    for (const userId of [E2E_USER_ID, OTHER_USER_ID]) {
      await query(
        `INSERT INTO episode (user_id, start_time, intensity, pain_location, pain_type)
         VALUES ($1, now() - interval '1 day', 3, 'left', 'throbbing')`,
        [userId],
      );
      await query('INSERT INTO community_post (author_id, title, body) VALUES ($1, $2, $3)', [userId, 'Post', 'Body']);
    }
  });

  test.afterEach(async () => {
    await query('DELETE FROM episode WHERE user_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM community_post WHERE author_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM "user" WHERE id = $1', [OTHER_USER_ID]);
  });

  test('cancelling keeps the account', async ({ page }) => {
    await page.goto(PRIVACY_PATH);
    await page.getByRole('button', { name: 'Delete my account' }).click();

    await expect(page.getByText('Are you absolutely sure?')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();
    expect(await count('SELECT count(*) AS n FROM "user" WHERE id = $1', E2E_USER_ID)).toBe(1);
  });

  test('confirming deletes the user\'s data, withdraws consents and leaves other users alone', async ({ page }) => {
    await page.goto(PRIVACY_PATH);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    const response = page.waitForResponse(r => r.url().endsWith('/api/user/delete-account'));
    await page.getByRole('button', { name: 'Yes, delete everything' }).click();

    expect((await response).status()).toBe(200);
    expect(await (await response).json()).toEqual({
      success: true,
      message: 'Account and all associated data have been deleted',
    });

    await expect(page).toHaveURL(/\/(?:en\/?)?$/);

    expect(await count('SELECT count(*) AS n FROM "user" WHERE id = $1', E2E_USER_ID)).toBe(0);
    expect(await count('SELECT count(*) AS n FROM episode WHERE user_id = $1', E2E_USER_ID)).toBe(0);
    expect(await count('SELECT count(*) AS n FROM community_post WHERE author_id = $1', E2E_USER_ID)).toBe(0);
    expect(await count('SELECT count(*) AS n FROM user_consent WHERE user_id = $1 AND withdrawn_at IS NULL', E2E_USER_ID)).toBe(0);
    expect(await count('SELECT count(*) AS n FROM user_consent WHERE user_id = $1', E2E_USER_ID)).toBeGreaterThan(0);

    expect(await count('SELECT count(*) AS n FROM "user" WHERE id = $1', OTHER_USER_ID)).toBe(1);
    expect(await count('SELECT count(*) AS n FROM episode WHERE user_id = $1', OTHER_USER_ID)).toBe(1);
    expect(await count('SELECT count(*) AS n FROM community_post WHERE author_id = $1', OTHER_USER_ID)).toBe(1);
  });
});
