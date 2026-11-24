import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

const OTHER_USER_ID = 'e2e_community_other_user';

async function otherUsersHiddenPost(): Promise<string> {
  await query('INSERT INTO "user" (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [OTHER_USER_ID, 'Other']);
  const [row] = await query<{ id: string }>(
    `INSERT INTO community_post (author_id, title, body, visibility) VALUES ($1, 'Hidden by mods', 'secret', 'HIDDEN') RETURNING id`,
    [OTHER_USER_ID],
  );
  return row!.id;
}

test.describe('community', () => {
  test.afterEach(async () => {
    await query('DELETE FROM community_report WHERE post_id IN (SELECT id FROM community_post WHERE author_id = $1)', [OTHER_USER_ID]);
    await query('DELETE FROM community_comment WHERE post_id IN (SELECT id FROM community_post WHERE author_id = $1)', [OTHER_USER_ID]);
    await query('DELETE FROM community_vote WHERE post_id IN (SELECT id FROM community_post WHERE author_id = $1)', [OTHER_USER_ID]);
    await query('DELETE FROM community_post WHERE author_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM "user" WHERE id = $1', [OTHER_USER_ID]);
  });

  test('user writes a post, comments on it and votes', async ({ page }) => {
    await page.goto('/en/dashboard/community/new');
    await page.getByLabel('Title').fill('Weather headaches');
    await page.getByLabel('What\'s on your mind?').fill('Pressure drops hit me hard this week.');
    await page.getByRole('button', { name: 'Share to community' }).click();

    await expect(page).toHaveURL(/\/dashboard\/community\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Weather headaches')).toBeVisible();

    const postId = page.url().split('/').pop()!;
    await page.getByPlaceholder('Add a comment…').fill('Same here');
    await page.getByRole('button', { name: 'Post comment' }).click();

    await expect(page.getByText('Same here')).toBeVisible();

    const [comment] = await query<{ author_id: string }>('SELECT author_id FROM community_comment WHERE post_id = $1', [postId]);

    expect(comment!.author_id).toBe(E2E_USER_ID);

    const vote = await page.request.post(`/api/community/posts/${postId}/vote`, { data: { value: 1 } });

    expect(await vote.json()).toEqual({ score: 1, viewerVote: 1 });

    const feed = await (await page.request.get('/api/community/posts?onlyOwn=1')).json();

    expect(feed.posts).toEqual([expect.objectContaining({ id: postId, isMine: true, commentCount: 1, viewerVote: 1, score: 1 })]);
  });

  test('API validates posts, votes, comments and reports', async ({ page }) => {
    const post = await page.request.post('/api/community/posts', { data: { title: 'x', body: '' } });

    expect(post.status()).toBe(400);
    expect(Object.keys((await post.json()).details.fieldErrors)).toEqual(['title', 'body']);

    const list = await page.request.get('/api/community/posts?limit=51');

    expect(list.status()).toBe(400);
    expect((await list.json()).error).toBe('Invalid query parameters');

    const report = await page.request.post('/api/community/report', { data: { reason: 'spam' } });

    expect(report.status()).toBe(400);
    expect((await report.json()).details.fieldErrors.postId).toEqual(['Either postId or commentId must be provided (but not both)']);
  });

  test('regular users cannot see hidden posts or use moderation tools', async ({ page }) => {
    const hidden = await otherUsersHiddenPost();

    expect((await page.request.get(`/api/community/posts/${hidden}`)).status()).toBe(404);
    expect((await page.request.post(`/api/community/posts/${hidden}/vote`, { data: { value: 1 } })).status()).toBe(404);
    expect((await page.request.get('/api/moderation/reports')).status()).toBe(403);
    expect((await page.request.post('/api/moderation/visibility', { data: { postId: hidden, visibility: 'PUBLIC' } })).status()).toBe(403);
    expect(await (await page.request.get('/api/moderation/role')).json()).toEqual({ role: 'user', isModerator: false, isAdmin: false });

    await page.goto('/en/dashboard/moderation');

    await expect(page.getByText('You don\'t have permission to access this page')).toBeVisible();

    const [row] = await query<{ visibility: string }>('SELECT visibility FROM community_post WHERE id = $1', [hidden]);

    expect(row!.visibility).toBe('HIDDEN');
  });

  test('a moderator reviews a report and unhides content', async ({ page }) => {
    const hidden = await otherUsersHiddenPost();
    await query('UPDATE "user" SET role = \'moderator\' WHERE id = $1', [E2E_USER_ID]);
    const [report] = await query<{ id: string }>(
      `INSERT INTO community_report (post_id, reporter_id, reason) VALUES ($1, $2, 'spam') RETURNING id`,
      [hidden, OTHER_USER_ID],
    );

    await page.goto('/en/dashboard/moderation');

    await expect(page.getByText('Moderation Dashboard')).toBeVisible();
    await expect(page.getByText('Hidden by mods: secret')).toBeVisible();

    const resolved = await page.request.post('/api/moderation/reports', { data: { reportId: report!.id, status: 'RESOLVED' } });

    expect(await resolved.json()).toEqual({ success: true });

    const unhide = await page.request.post('/api/moderation/visibility', { data: { postId: hidden, visibility: 'PUBLIC' } });

    expect(unhide.status()).toBe(200);

    const [row] = await query<{ visibility: string; status: string; resolved_by: string }>(
      `SELECT p.visibility, r.status, r.resolved_by FROM community_post p JOIN community_report r ON r.post_id = p.id WHERE p.id = $1`,
      [hidden],
    );

    expect(row).toEqual({ visibility: 'PUBLIC', status: 'RESOLVED', resolved_by: E2E_USER_ID });
    expect((await page.request.get('/api/moderation/users')).status()).toBe(403);
  });
});
