import { execSync } from 'node:child_process';
import { E2E_USER_ID, query } from './_db';
import { test as base, expect } from './_fixtures';

/**
 * Pain timeline on the attack page: record how pain rises and falls within
 * one attack, including an attack that ran over several days. Uses the
 * default seed plus scripts/e2e-seed-pain-timeline.ts (a multi-day attack for
 * this user, and another user's attack with a reading that must stay hidden).
 */
const test = base.extend<{ seeded: void }>({
  seeded: [

    async ({}, use) => {
      execSync('npm run e2e:reset --silent', { stdio: 'inherit' });
      execSync('npm run e2e:seed --silent', { stdio: 'inherit' });
      execSync('npm run e2e:seed:pain-timeline --silent', { stdio: 'inherit' });
      await use();
    },
    { auto: true },
  ],
});

test.use({ timezoneId: 'Europe/Berlin' });

const OTHER_USER = 'e2e_pain_timeline_other_user';
const HOUR = 60 * 60 * 1000;

type Attack = { id: number; start_time: Date; end_time: Date; intensity: number };

async function seededAttack(): Promise<Attack> {
  const [row] = await query<Attack>(
    `select id, start_time, end_time, intensity from episode where user_id = $1 and notes = 'PainTimelineSeedAttack'`,
    [E2E_USER_ID],
  );
  return row!;
}

const readings = (episodeId: number) =>
  query<{ id: string; recorded_at: Date; intensity: number }>(
    'select id, recorded_at, intensity from episode_pain_reading where episode_id = $1 order by recorded_at',
    [episodeId],
  );

const intensityOf = async (episodeId: number) =>
  (await query<{ intensity: number }>('select intensity from episode where id = $1', [episodeId]))[0]!.intensity;

/** `YYYY-MM-DDTHH:mm` in Europe/Berlin, matching the browser's timezone. */
function berlinLocal(ms: number): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Whole minutes, as the time picker has minute precision. */
const toMinute = (ms: number) => Math.floor(ms / 60_000) * 60_000;

test('records pain rising and falling over a multi-day attack', async ({ page }) => {
  const attack = await seededAttack();
  const start = new Date(attack.start_time).getTime();

  await page.goto(`/en/dashboard/episodes/${attack.id}`);

  const timeline = page.getByTestId('pain-timeline');

  await expect(timeline.getByRole('heading', { name: 'Pain over time' })).toBeVisible();
  await expect(timeline.getByText(/No readings yet/)).toBeVisible();

  // Pain builds an hour after onset...
  const first = toMinute(start + HOUR) + 60_000;
  await timeline.getByRole('button', { name: /Pain level 4/ }).click();
  await timeline.getByLabel('Time', { exact: true }).fill(berlinLocal(first));
  await timeline.getByRole('button', { name: 'Add reading' }).click();

  await expect(timeline.getByTestId('pain-reading-row')).toHaveCount(1);
  await expect.poll(async () => (await readings(attack.id)).map(r => [new Date(r.recorded_at).getTime(), r.intensity]))
    .toEqual([[first, 4]]);
  // The first reading replaces the level logged with the attack.
  await expect.poll(() => intensityOf(attack.id)).toBe(4);

  // ...eases the next day...
  const second = toMinute(start + 30 * HOUR);
  await timeline.getByRole('button', { name: /Pain level 2/ }).click();
  await timeline.getByLabel('Time', { exact: true }).fill(berlinLocal(second));
  await timeline.getByRole('button', { name: 'Add reading' }).click();

  await expect(timeline.getByTestId('pain-reading-row')).toHaveCount(2);
  await expect(timeline.getByTestId('pain-timeline-peak')).toContainText('4');

  // The chart spans every day of the attack, with a marker at each midnight.
  await expect(timeline.getByRole('img', { name: /2 readings/ })).toBeVisible();
  expect(await timeline.getByTestId('pain-timeline-midnight').count()).toBeGreaterThanOrEqual(2);

  // The peak stays the attack's level after a lower reading.
  expect(await intensityOf(attack.id)).toBe(4);

  // Deleting the peak reading lowers the attack's level to what remains.
  await timeline.getByTestId('pain-reading-row').first().getByRole('button', { name: /Delete reading/ }).click();

  await expect(timeline.getByTestId('pain-reading-row')).toHaveCount(1);
  await expect.poll(() => intensityOf(attack.id)).toBe(2);

  // The readings survive a reload.
  await page.reload();

  await expect(page.getByTestId('pain-reading-row')).toHaveCount(1);
});

test('refuses a reading outside the attack', async ({ page }) => {
  const attack = await seededAttack();
  const start = new Date(attack.start_time).getTime();

  await page.goto(`/en/dashboard/episodes/${attack.id}`);
  const timeline = page.getByTestId('pain-timeline');
  await timeline.getByRole('button', { name: /Pain level 3/ }).click();
  await timeline.getByLabel('Time', { exact: true }).fill(berlinLocal(start - 3 * HOUR));
  await timeline.getByRole('button', { name: 'Add reading' }).click();

  await expect(timeline.getByRole('alert')).toHaveText('That time is before the attack started.');
  expect(await readings(attack.id)).toEqual([]);

  const end = new Date(attack.end_time).getTime();
  const late = await page.request.post(`/api/episodes/${attack.id}/pain-readings`, {
    data: { intensity: 3, recordedAt: new Date(end + HOUR).toISOString() },
  });
  const tooHigh = await page.request.post(`/api/episodes/${attack.id}/pain-readings`, {
    data: { intensity: 9, recordedAt: new Date(start + HOUR).toISOString() },
  });
  const notANumber = await page.request.post(`/api/episodes/${attack.id}/pain-readings`, {
    data: { intensity: 'bad' },
  });

  expect(late.status()).toBe(400);
  expect((await late.json()).details).toEqual({ reason: 'after_end' });
  expect(tooHigh.status()).toBe(400);
  expect(notANumber.status()).toBe(400);
  expect(await readings(attack.id)).toEqual([]);
  expect(await intensityOf(attack.id)).toBe(3);
});

test('never shows or changes another user\'s pain readings', async ({ page }) => {
  const [other] = await query<{ id: number }>('select id from episode where user_id = $1', [OTHER_USER]);
  const [otherReading] = await readings(other!.id);

  const list = await page.request.get(`/api/episodes/${other!.id}/pain-readings`);
  const add = await page.request.post(`/api/episodes/${other!.id}/pain-readings`, {
    data: { intensity: 1, recordedAt: new Date(Date.now() - 3 * HOUR).toISOString() },
  });
  const remove = await page.request.delete(`/api/episodes/${other!.id}/pain-readings/${otherReading!.id}`);

  // Even under the e2e user's own attack id, the other user's reading is not found.
  const attack = await seededAttack();
  const crossRemove = await page.request.delete(`/api/episodes/${attack.id}/pain-readings/${otherReading!.id}`);

  expect(list.status()).toBe(404);
  expect(add.status()).toBe(404);
  expect(remove.status()).toBe(404);
  expect(crossRemove.status()).toBe(404);

  expect((await readings(other!.id)).map(r => r.intensity)).toEqual([5]);
  expect(await intensityOf(other!.id)).toBe(5);

  // The e2e user's own attack shows none of it.
  await page.goto(`/en/dashboard/episodes/${attack.id}`);

  await expect(page.getByTestId('pain-timeline').getByText(/No readings yet/)).toBeVisible();
});
