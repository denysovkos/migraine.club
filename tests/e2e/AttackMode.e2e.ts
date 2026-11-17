import { execSync } from 'node:child_process';
import { query } from './_db';
import { test as base, expect } from './_fixtures';

/**
 * Attack mode (/quick/attack): a dim, low-stimulus screen with three large
 * actions for logging while in pain. Uses the default seed plus
 * scripts/e2e-seed-attack-mode.ts (recent medications, and another user's
 * ongoing attack that must stay invisible).
 */
const test = base.extend<{ seeded: void }>({
  seeded: [

    async ({}, use) => {
      execSync('npm run e2e:reset --silent', { stdio: 'inherit' });
      execSync('npm run e2e:seed --silent', { stdio: 'inherit' });
      execSync('npm run e2e:seed:attack-mode --silent', { stdio: 'inherit' });
      await use();
    },
    { auto: true },
  ],
});

test.use({ viewport: { width: 390, height: 844 } });

const USER = 'e2e_user_test_001';

type EpisodeRow = { id: number; is_ongoing: boolean; end_time: Date | null; intensity: number };

const episodes = () =>
  query<EpisodeRow>('select id, is_ongoing, end_time, intensity from episode where user_id = $1 order by id', [USER]);

test('logs a whole attack in attack mode: start, pain, medication, end', async ({ page }) => {
  await page.goto('/en/quick/attack');

  await expect(page.getByRole('heading', { name: 'Attack mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pain level/ })).toBeDisabled();

  // Huge tap targets: each home action is far above the 44px minimum.
  const start = page.getByRole('button', { name: /Attack started/ });
  const box = await start.boundingBox();

  expect(box!.height).toBeGreaterThan(150);

  await start.click();

  await expect(page.getByRole('button', { name: /Attack over/ })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/Attack started at/);

  await expect.poll(async () => (await episodes()).map(e => e.is_ongoing)).toEqual([true]);

  await page.getByRole('button', { name: /Pain level/ }).click();
  await page.getByRole('button', { name: 'Severe' }).click();

  await expect(page.getByRole('button', { name: /Pain level/ })).toContainText('Now: Severe');
  await expect.poll(async () => (await episodes())[0]?.intensity).toBe(4);

  await page.getByRole('button', { name: /Took medication/ }).click();

  // Most used first, at most three, the user's own only.
  const medButtons = page.getByRole('button', { name: /mg$/ });

  await expect(medButtons).toHaveText([/Sumatriptan/, /Ibuprofen/]);

  await medButtons.first().click();

  await expect(page.getByRole('status')).toHaveText('Sumatriptan logged');

  const [episode] = await episodes();
  const intakes = await query<{ episode_id: number; dose: string; unit: string }>(
    // Seeded intakes are all in the past days; only the new one is from today.
    `select episode_id, dose, unit from medication_intakes
      where user_id = $1 and taken_at > now() - interval '1 hour'`,
    [USER],
  );

  expect(intakes).toEqual([{ episode_id: episode!.id, dose: '50', unit: 'mg' }]);

  await expect.poll(async () => (await query(
    'select 1 from acute_doses where user_id = $1',
    [USER],
  )).length).toBe(1);

  await page.getByRole('button', { name: /Attack over/ }).click();

  await expect(page.getByRole('status')).toHaveText('Attack ended. Rest well.');
  await expect(page.getByRole('button', { name: /Attack started/ })).toBeVisible();

  const [ended] = await episodes();

  expect(ended!.is_ongoing).toBe(false);
  expect(ended!.end_time).not.toBeNull();
});

test('undo removes a just-started attack', async ({ page }) => {
  await page.goto('/en/quick/attack');
  await page.getByRole('button', { name: /Attack started/ }).click();

  await expect(page.getByRole('button', { name: /Attack over/ })).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(page.getByRole('status')).toHaveText('Undone');
  await expect(page.getByRole('button', { name: /Attack started/ })).toBeVisible();
  await expect.poll(async () => (await episodes()).length).toBe(0);
});

test('opens from the Quick log sheet and exits back to the dashboard', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  await page.getByRole('button', { name: 'Quick log' }).click();
  await page.getByRole('button', { name: /Attack mode/ }).click();

  await page.waitForURL(/\/quick\/attack$/);

  await expect(page.getByRole('button', { name: /Attack started/ })).toBeVisible();

  await page.getByRole('link', { name: 'Exit' }).click();
  await page.waitForURL(/\/dashboard$/);
});

test('is translated', async ({ page }) => {
  await page.goto('/uk/quick/attack');

  await expect(page.getByRole('heading', { name: 'Режим нападу' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Напад почався/ })).toBeVisible();
});

test('never shows another user\'s attack or medications', async ({ page }) => {
  await page.goto('/en/quick/attack');

  // The other user has an ongoing attack; this user does not.
  await expect(page.getByRole('button', { name: /Attack started/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Attack over/ })).toHaveCount(0);

  await page.getByRole('button', { name: /Took medication/ }).click();

  await expect(page.getByRole('button', { name: /Sumatriptan/ })).toBeVisible();
  await expect(page.getByText('OtherUserOnlyMed')).toHaveCount(0);

  // Ending or rating the other user's attack by id is refused.
  const [other] = await query<{ id: number }>(
    'select id from episode where user_id = $1 and is_ongoing',
    ['e2e_attack_mode_other_user'],
  );
  const end = await page.request.patch(`/api/episodes/${other!.id}`, { data: { endNow: true } });
  const pain = await page.request.patch(`/api/episodes/${other!.id}`, { data: { intensity: 1 } });

  expect(end.status()).toBe(404);
  expect(pain.status()).toBe(404);

  const [stillOngoing] = await query<{ is_ongoing: boolean; intensity: number }>(
    'select is_ongoing, intensity from episode where id = $1',
    [other!.id],
  );

  expect(stillOngoing).toEqual({ is_ongoing: true, intensity: 5 });
});

test('rejects an out-of-range pain level', async ({ page }) => {
  await page.goto('/en/quick/attack');
  await page.getByRole('button', { name: /Attack started/ }).click();

  await expect(page.getByRole('button', { name: /Attack over/ })).toBeVisible();

  const [episode] = await episodes();
  const res = await page.request.patch(`/api/episodes/${episode!.id}`, { data: { intensity: 9 } });

  expect(res.status()).toBe(400);
  expect((await episodes())[0]!.intensity).toBe(3);
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('opens and logs without a connection, then syncs with the time of the tap', async ({ page, context, browserName }) => {
    await page.goto('/en/quick/attack');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();

    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);

    // Reopened offline: served from the service worker cache. (English has no
    // locale prefix, so /en/quick/attack redirected to this path above.)
    await page.goto('/quick/attack');
    const tappedAt = Date.now();
    await page.getByRole('button', { name: /Attack started/ }).click();

    await expect(page.getByRole('status')).toHaveText('Attack saved on this device');
    await expect(page.getByRole('button', { name: /Attack over/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Attack over/ })).toContainText('syncing later');

    await page.waitForTimeout(2_000);
    await context.setOffline(false);
    if (browserName === 'firefox') {
      // See OfflineLogging.e2e.ts: Firefox does not dispatch `online` here.
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    }

    await expect.poll(async () => {
      const rows = await query<{ start_time: Date; is_ongoing: boolean }>(
        'select start_time, is_ongoing from episode where user_id = $1',
        [USER],
      );
      return rows.map(r => r.is_ongoing);
    }, { timeout: 20_000 }).toEqual([true]);

    const [row] = await query<{ start_time: Date }>('select start_time from episode where user_id = $1', [USER]);

    expect(new Date(row!.start_time).getTime()).toBeGreaterThanOrEqual(tappedAt - 1_000);
    expect(new Date(row!.start_time).getTime()).toBeLessThan(tappedAt + 1_500);
  });
});
