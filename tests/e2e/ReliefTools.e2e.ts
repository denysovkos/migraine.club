import { execSync } from 'node:child_process';
import { E2E_USER_ID, query } from './_db';
import { test as base, expect } from './_fixtures';

/**
 * In-attack relief tools: attack mode "Relax" offers slow breathing, muscle
 * relaxation and guided relaxation, then asks whether it helped and records
 * the session (linked to the ongoing attack when there is one). Uses the
 * default seed plus scripts/e2e-seed-relief.ts (another user's attack with a
 * relief session that must stay invisible).
 */
const test = base.extend<{ seeded: void }>({
  seeded: [

    async ({}, use) => {
      execSync('npm run e2e:reset --silent', { stdio: 'inherit' });
      execSync('npm run e2e:seed --silent', { stdio: 'inherit' });
      execSync('npm run e2e:seed:relief --silent', { stdio: 'inherit' });
      await use();
    },
    { auto: true },
  ],
});

test.use({ viewport: { width: 390, height: 844 } });

type SessionRow = {
  episode_id: number | null;
  exercise: string;
  duration_seconds: number;
  completed: boolean;
  helped: string | null;
};

const sessions = () =>
  query<SessionRow>(
    'select episode_id, exercise, duration_seconds, completed, helped from relief_session where user_id = $1 order by started_at',
    [E2E_USER_ID],
  );

async function otherUsersAttackId(): Promise<number> {
  const [row] = await query<{ id: number }>(`select id from episode where notes = 'ReliefOtherUserAttack'`);
  return row!.id;
}

test('completes slow breathing during an attack and records that it helped', async ({ page }) => {
  await page.clock.install();
  await page.goto('/en/quick/attack');

  await page.getByRole('button', { name: /Attack started/ }).click();

  await expect(page.getByRole('button', { name: /Attack over/ })).toBeVisible();

  // Four large actions on the home screen, Relax among them.
  const relax = page.getByRole('button', { name: /Relax/ });

  expect((await relax.boundingBox())!.height).toBeGreaterThan(150);

  await relax.click();

  await expect(page.getByRole('heading', { name: 'Something to ease the pain' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Slow breathing/ })).toContainText('3 min · In for 4, out for 6');

  await page.getByRole('button', { name: /Slow breathing/ }).click();

  const step = page.getByTestId('relief-step');

  await expect(step).toHaveText(/Let your shoulders drop/);

  await page.clock.fastForward(10_000);

  await expect(step).toHaveText('Breathe in');
  await expect(page.getByText('Breath 1 of 18')).toBeVisible();

  await page.clock.fastForward(4_000);

  await expect(step).toHaveText('Breathe out, slowly');

  // Run the rest of the 200-second session.
  await page.clock.fastForward(190_000);

  await expect(page.getByRole('heading', { name: 'Did it help?' })).toBeVisible();

  await page.getByRole('button', { name: 'A little' }).click();

  await expect(page.getByRole('status')).toHaveText('Relaxation saved');
  await expect(page.getByRole('button', { name: /Attack over/ })).toBeVisible();

  const [attack] = await query<{ id: number }>('select id from episode where user_id = $1 and is_ongoing', [E2E_USER_ID]);

  await expect.poll(sessions).toEqual([
    { episode_id: attack!.id, exercise: 'breathing', duration_seconds: 200, completed: true, helped: 'a_little' },
  ]);
});

test('stops muscle relaxation early without an attack and skips the question', async ({ page }) => {
  await page.clock.install();
  await page.goto('/en/quick/attack');

  await page.getByRole('button', { name: /Relax/ }).click();
  await page.getByRole('button', { name: /Muscle relaxation/ }).click();

  await expect(page.getByTestId('relief-step')).toHaveText(/Your face and neck only soften/);

  await page.clock.fastForward(15_000);

  await expect(page.getByTestId('relief-step')).toHaveText('Make fists with both hands. Hold.');

  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(page.getByRole('status')).toHaveText('Relaxation saved');

  await expect.poll(async () => (await sessions()).map(s => ({ ...s, duration_seconds: s.duration_seconds >= 15 })))
    .toEqual([{ episode_id: null, exercise: 'pmr', duration_seconds: true, completed: false, helped: null }]);
});

test('relief screens are translated and voice is off by default', async ({ page }) => {
  await page.goto('/uk/quick/attack');
  await page.getByRole('button', { name: /Розслабитися/ }).click();

  await expect(page.getByRole('button', { name: /Повільне дихання/ })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Голос: вимк.' })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Назад' }).click();

  await expect(page.getByRole('button', { name: /Напад почався/ })).toBeVisible();
});

test('validates relief sessions at the API boundary', async ({ page }) => {
  await page.goto('/en/quick/attack');
  const valid = { exercise: 'breathing', startedAt: new Date().toISOString(), durationSeconds: 60, completed: true };

  for (const data of [
    { ...valid, exercise: 'yoga' },
    { ...valid, durationSeconds: -5 },
    { ...valid, durationSeconds: 999_999 },
    { ...valid, helped: 'maybe' },
    { ...valid, startedAt: 'yesterday' },
    { ...valid, startedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
  ]) {
    const res = await page.request.post('/api/relief-sessions', { data });

    expect(res.status(), JSON.stringify(data)).toBe(400);
  }

  expect((await page.request.get('/api/relief-sessions?episodeId=abc')).status()).toBe(400);

  const ok = await page.request.post('/api/relief-sessions', { data: { ...valid, helped: 'no' } });

  expect(ok.status()).toBe(201);
  expect(await sessions()).toHaveLength(1);
});

test('never shows or links to another user\'s attack or sessions', async ({ page }) => {
  await page.goto('/en/quick/attack');
  const otherAttack = await otherUsersAttackId();

  const linked = await page.request.post('/api/relief-sessions', {
    data: {
      exercise: 'pmr',
      startedAt: new Date().toISOString(),
      durationSeconds: 30,
      completed: false,
      episodeId: otherAttack,
    },
  });

  expect(linked.status()).toBe(404);
  expect(await sessions()).toEqual([]);

  const mine = await (await page.request.get('/api/relief-sessions')).json();

  expect(mine).toEqual({ sessions: [] });

  const forOther = await (await page.request.get(`/api/relief-sessions?episodeId=${otherAttack}`)).json();

  expect(forOther).toEqual({ sessions: [] });

  // The other user's session is still there, untouched.
  expect(await query('select 1 from relief_session where episode_id = $1', [otherAttack])).toHaveLength(1);
});
