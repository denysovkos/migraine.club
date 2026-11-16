import { readFileSync } from 'node:fs';
import pg from 'pg';
import { expect, test } from './_fixtures';

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });

/**
 * Offline logging: entries made without a connection are kept on the device,
 * survive a reload, and sync with their original time once back online.
 * See docs/OFFLINE_LOGGING.md.
 */
test('logs a diary day and an attack offline, then syncs them with their original times', async ({ page, context }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  // Let the service worker take control and cache the dashboard + read APIs.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  const tappedAt = Date.now();

  // Diary: mark today pain-free.
  const hero = page.getByLabel('Today check-in');
  await hero.getByRole('button', { name: 'No pain', exact: true }).click();

  await expect(page.getByText(/Saved on this device/).first()).toBeVisible({ timeout: 10_000 });

  // Attack: start a migraine now.
  await page.getByRole('button', { name: 'Start attack' }).first().click();
  const sheet = page.locator('div.fixed.inset-0.z-50').filter({ hasText: 'Start an attack' });
  await sheet.getByRole('button', { name: /Migraine/ }).first().click();

  const pill = page.getByRole('button', { name: /Offline · 2 entries waiting to sync/ });

  await expect(pill).toBeVisible({ timeout: 10_000 });

  // Still there after reopening with no connection: the page comes from the
  // service worker cache and the entries from IndexedDB.
  await page.goto('/dashboard');

  await expect(pill).toBeVisible({ timeout: 15_000 });

  await pill.click();

  await expect(page.getByText('Attack', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Diary · \d{4}-\d{2}-\d{2}$/)).toBeVisible();

  await page.keyboard.press('Escape');

  // Make sure syncing happens noticeably later than the taps.
  await page.waitForTimeout(3_000);
  const syncStartedAt = Date.now();
  await context.setOffline(false);

  await expect(page.getByText(/2 offline entries synced/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /waiting to sync|couldn't sync/ })).toHaveCount(0);

  const diary = await page.request.get('/api/diary/today').then(r => r.json());

  // Synced in capture order: the pain-free mark first, then the migraine,
  // whose attack evidence turns today into a migraine day. Had the attack gone
  // first, the later "pain-free" write would have been rejected instead.
  expect(diary.entry?.dayType).toBe('migraine_day');

  const recent = await page.request.get('/api/episodes/recent?limit=5').then(r => r.json());
  const ongoing = (recent.episodes as Array<{ isOngoing: boolean; startTime: string; attackType: string }>)
    .find(e => e.isOngoing);

  expect(ongoing?.attackType).toBe('migraine');

  const startedAt = new Date(ongoing!.startTime).getTime();

  // The attack keeps the time of the tap, not the time it was synced.
  expect(startedAt).toBeGreaterThanOrEqual(tappedAt - 1_000);
  expect(startedAt).toBeLessThan(syncStartedAt);
});

// ---------------------------------------------------------------------------
// Server-side guarantees, checked against the real database.

function databaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  // The seed scripts read .env through dotenv; do the same here.
  const line = readFileSync('.env', 'utf8').split('\n').find(l => l.startsWith('DATABASE_URL='));
  return line!.slice('DATABASE_URL='.length).trim();
}

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

const USER = 'e2e_user_test_001';

test('a replayed write with the same Idempotency-Key creates the attack only once', async ({ page }) => {
  await page.goto('/en/dashboard');
  const key = `e2e-${Date.now()}-dedupe`;
  const send = () => page.request.post('/api/quick-add/episode', {
    headers: { 'Idempotency-Key': key, 'X-Offline-User': USER },
    data: { attackType: 'migraine', startedAt: new Date(Date.now() - 10 * 60_000).toISOString() },
  });

  // Two concurrent attempts (e.g. page and service worker) plus a late replay.
  const [a, b] = await Promise.all([send(), send()]);
  const c = await send();

  const statuses = [a.status(), b.status()].sort();

  // One wins; the other either sees the stored result or is told to retry.
  expect(statuses[0]).toBe(201);
  expect([201, 409]).toContain(statuses[1]);
  expect(c.status()).toBe(201);
  expect(c.headers()['idempotent-replayed']).toBe('true');

  const ids = new Set([a, b, c].filter(r => r.status() === 201).map(r => r.json()));
  const resolved = await Promise.all([...ids]);

  expect(new Set(resolved.map(r => r.episodeId)).size).toBe(1);

  const rows = await query('select id from episode where user_id = $1', [USER]);

  expect(rows).toHaveLength(1);
});

test('refuses an entry captured by a different account on this device', async ({ page }) => {
  await page.goto('/en/dashboard');
  const res = await page.request.post('/api/quick-add/episode', {
    headers: { 'Idempotency-Key': `e2e-${Date.now()}-other`, 'X-Offline-User': 'someone_else' },
    data: { attackType: 'migraine' },
  });

  expect(res.status()).toBe(409);
  expect((await res.json()).code).toBe('OFFLINE_USER_MISMATCH');
  expect(await query('select id from episode where user_id = $1', [USER])).toHaveLength(0);
});

test('rejects capture times in the future or outside the sync window', async ({ page }) => {
  await page.goto('/en/dashboard');
  const future = await page.request.post('/api/quick-add/episode', {
    data: { attackType: 'migraine', startedAt: new Date(Date.now() + 60 * 60_000).toISOString() },
  });
  const tooOld = await page.request.post('/api/quick-add/medication-intake', {
    data: { customName: 'Ibuprofen', takenAt: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString() },
  });

  expect(future.status()).toBe(400);
  expect(tooOld.status()).toBe(400);
});

test('a dose synced late keeps its time, links to the attack it belongs to, and records the acute dose', async ({ page }) => {
  await page.goto('/en/dashboard');
  const attackStart = new Date(Date.now() - 60 * 60_000);
  const takenAt = new Date(Date.now() - 40 * 60_000);

  const attack = await page.request.post('/api/quick-add/episode', {
    data: { attackType: 'migraine', startedAt: attackStart.toISOString() },
  });

  expect(attack.status()).toBe(201);

  const { episodeId } = await attack.json();
  const dose = await page.request.post('/api/quick-add/medication-intake', {
    headers: { 'Idempotency-Key': `e2e-${Date.now()}-dose` },
    data: { customName: 'Ibuprofen', dose: '400', unit: 'mg', takenAt: takenAt.toISOString(), recordAcuteDose: true },
  });

  expect(dose.status()).toBe(201);

  const body = await dose.json();

  expect(body.linkedEpisodeId).toBe(episodeId);
  expect(body.acuteDoseId).toBeTruthy();

  const [intake] = await query<{ taken_at: Date; episode_id: number }>(
    'select taken_at, episode_id from medication_intakes where id = $1',
    [body.intakeId],
  );
  const [acute] = await query<{ taken_at: Date; attack_id: number }>(
    'select taken_at, attack_id from acute_doses where id = $1',
    [body.acuteDoseId],
  );

  expect(new Date(intake!.taken_at).toISOString()).toBe(takenAt.toISOString());
  expect(intake!.episode_id).toBe(episodeId);
  expect(new Date(acute!.taken_at).toISOString()).toBe(takenAt.toISOString());
  expect(acute!.attack_id).toBe(episodeId);
});

test('a dose taken before the ongoing attack started is not attached to it', async ({ page }) => {
  await page.goto('/en/dashboard');
  await page.request.post('/api/quick-add/episode', {
    data: { attackType: 'migraine', startedAt: new Date(Date.now() - 10 * 60_000).toISOString() },
  });
  const dose = await page.request.post('/api/quick-add/medication-intake', {
    data: { customName: 'Paracetamol', takenAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() },
  });

  expect(dose.status()).toBe(201);
  expect((await dose.json()).linkedEpisodeId).toBeUndefined();
});

test('ending an attack offline keeps the time of the tap', async ({ page, context }) => {
  await page.goto('/en/dashboard');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const started = await page.request.post('/api/quick-add/episode', {
    data: { attackType: 'migraine', startedAt: new Date(Date.now() - 30 * 60_000).toISOString() },
  });
  const { episodeId } = await started.json();
  await page.reload();

  const endButton = page.getByRole('button', { name: 'End attack' });

  await expect(endButton).toBeVisible({ timeout: 10_000 });

  await context.setOffline(true);
  const tappedAt = Date.now();
  await endButton.click();

  await expect(page.getByRole('button', { name: /Offline · 1 entry waiting to sync/ })).toBeVisible({ timeout: 10_000 });

  await page.waitForTimeout(3_000);
  const syncStartedAt = Date.now();
  await context.setOffline(false);

  await expect(page.getByText(/1 offline entry synced/)).toBeVisible({ timeout: 20_000 });

  const [row] = await query<{ end_time: Date; is_ongoing: boolean }>(
    'select end_time, is_ongoing from episode where id = $1',
    [episodeId],
  );

  expect(row!.is_ongoing).toBe(false);

  const endedAt = new Date(row!.end_time).getTime();

  expect(endedAt).toBeGreaterThanOrEqual(tappedAt - 1_000);
  expect(endedAt).toBeLessThan(syncStartedAt);
});

test('an entry the server rejects is shown for review and can be discarded', async ({ page }) => {
  await page.goto('/en/dashboard');

  await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

  // Put an entry the server will refuse (invalid payload) straight into the outbox.
  await page.evaluate(async (userId) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('mc-offline', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('outbox', { keyPath: 'id' });
      open.onsuccess = () => {
        const tx = open.result.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').put({
          id: `e2e-bad-${Date.now()}`,
          userId,
          kind: 'diary',
          label: 'not-a-date',
          url: '/api/diary/entry',
          method: 'PUT',
          body: JSON.stringify({ localDate: 'not-a-date', patch: { dayType: 'headache_free' } }),
          createdAt: Date.now(),
          attempts: 0,
          status: 'pending',
          lastError: null,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, USER);

  // Reopening the app triggers a sync.
  await page.reload();

  const pill = page.getByRole('button', { name: /1 entry couldn't sync/ });

  await expect(pill).toBeVisible({ timeout: 15_000 });

  await pill.click();

  // The server's validation error is shown next to the state.
  await expect(page.getByText(/^Couldn't sync · /)).toBeVisible();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Discard' }).click();

  await expect(pill).toHaveCount(0, { timeout: 10_000 });
});

test('a reservation left by a crashed request blocks briefly, then is taken over', async ({ page }) => {
  await page.goto('/en/dashboard');
  const fresh = `e2e-${Date.now()}-fresh`;
  const stale = `e2e-${Date.now()}-stale`;
  await query(
    `insert into idempotent_request (user_id, idempotency_key, route, created_at)
     values ($1, $2, 'quick-add/episode', now()), ($1, $3, 'quick-add/episode', now() - interval '5 minutes')`,
    [USER, fresh, stale],
  );

  const blocked = await page.request.post('/api/quick-add/episode', {
    headers: { 'Idempotency-Key': fresh },
    data: { attackType: 'migraine' },
  });

  // Still in flight: the client is told to retry later, nothing is created.
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).code).toBe('IDEMPOTENCY_IN_PROGRESS');
  expect(await query('select id from episode where user_id = $1', [USER])).toHaveLength(0);

  const takenOver = await page.request.post('/api/quick-add/episode', {
    headers: { 'Idempotency-Key': stale },
    data: { attackType: 'migraine' },
  });

  expect(takenOver.status()).toBe(201);

  const [row] = await query<{ response_status: number }>(
    'select response_status from idempotent_request where user_id = $1 and idempotency_key = $2',
    [USER, stale],
  );

  expect(row!.response_status).toBe(201);
});

test('a failed write releases its key so the corrected retry can succeed', async ({ page }) => {
  await page.goto('/en/dashboard');
  const key = `e2e-${Date.now()}-release`;
  const first = await page.request.post('/api/quick-add/episode', {
    headers: { 'Idempotency-Key': key },
    data: { attackType: 'migraine', startedAt: 'not-a-date' },
  });

  expect(first.status()).toBe(400);
  expect(await query('select id from idempotent_request where idempotency_key = $1', [key])).toHaveLength(0);

  const retry = await page.request.post('/api/quick-add/episode', {
    headers: { 'Idempotency-Key': key },
    data: { attackType: 'migraine' },
  });

  expect(retry.status()).toBe(201);
});

test('Background Sync replays the queue after the app was closed (Chromium)', async ({ page, context }) => {
  await page.goto('/en/dashboard');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const hero = page.getByLabel('Today check-in');
  await hero.getByRole('button', { name: 'No pain', exact: true }).waitFor();

  await context.setOffline(true);
  await hero.getByRole('button', { name: 'No pain', exact: true }).click();

  await expect(page.getByRole('button', { name: /Offline · 1 entry waiting to sync/ })).toBeVisible({ timeout: 10_000 });

  // Close the app, then reconnect: only the service worker is left to sync.
  await page.close();
  await context.setOffline(false);

  await expect.poll(async () => {
    const res = await context.request.get('/api/diary/today');
    return (await res.json()).entry?.dayType ?? null;
  }, { timeout: 20_000 }).toBe('headache_free');
});
