import type { Download, Page } from '@playwright/test';
import type { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

const PRIVACY_PATH = '/en/dashboard/settings/privacy';
const OTHER_USER_ID = 'e2e_export_other_user';

type ExportJson = {
  format: string;
  userId: string;
  tables: Record<string, Record<string, unknown>[]>;
};

/** Minimal reader for the archive: walks the central directory. */
function unzip(buf: Buffer): Map<string, string> {
  const eocd = buf.length - 22;
  const count = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26);
    files.set(name, inflateRawSync(buf.subarray(dataStart, dataStart + compressedSize)).toString('utf8'));
    cursor += 46 + nameLength;
  }
  return files;
}

async function downloadVia(page: Page, buttonName: string): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: buttonName }).click(),
  ]);
  return download;
}

test.describe('data export', () => {
  test('downloads a JSON file with the user\'s own records', async ({ page }) => {
    await page.goto(PRIVACY_PATH);

    await expect(page.getByText('Export Your Data', { exact: true })).toBeVisible();

    const download = await downloadVia(page, 'Download JSON');

    expect(download.suggestedFilename()).toMatch(/^migraine-club-export-\d{4}-\d{2}-\d{2}\.json$/);

    const data = JSON.parse(await readFile(await download.path(), 'utf8')) as ExportJson;

    expect(data.format).toBe('migraine.club/user-data-export');
    expect(data.userId).toBe(E2E_USER_ID);
    expect(data.tables.user).toEqual([expect.objectContaining({ id: E2E_USER_ID, displayName: 'E2E User' })]);
    expect(data.tables.user![0]).not.toHaveProperty('stripeCustomerId');
    expect(data.tables.daily_diary_entry!.length).toBeGreaterThan(0);
    expect(data.tables.preventive_plan).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Topiramate (E2E)' })]),
    );
    expect(data.tables.user_consent!.map(c => c.consentType)).toEqual(
      expect.arrayContaining(['health_data', 'terms', 'privacy']),
    );
  });

  test('downloads a ZIP with one CSV per record type', async ({ page }) => {
    await page.goto(PRIVACY_PATH);

    const download = await downloadVia(page, 'Download CSV (ZIP)');

    expect(download.suggestedFilename()).toMatch(/^migraine-club-export-\d{4}-\d{2}-\d{2}-csv\.zip$/);

    const files = unzip(await readFile(await download.path()));

    expect([...files.keys()]).toEqual(expect.arrayContaining([
      'README.txt',
      'manifest.json',
      'user.csv',
      'episode.csv',
      'daily_diary_entry.csv',
      'preventive_plan.csv',
    ]));

    // BOM for spreadsheet apps, then a header row even when a table is empty.
    expect(files.get('episode.csv')!.startsWith('﻿id,userId,')).toBe(true);
    expect(files.get('preventive_plan.csv')).toContain('Topiramate (E2E)');

    const manifest = JSON.parse(files.get('manifest.json')!);

    expect(manifest.userId).toBe(E2E_USER_ID);
    expect(manifest.counts.daily_diary_entry).toBeGreaterThan(0);
  });

  test('an attack logged in the app shows up in the next export', async ({ page }) => {
    await page.goto('/en/dashboard');
    const created = await page.request.post('/api/quick-add/episode', {
      data: { attackType: 'migraine', startedAt: new Date(Date.now() - 30 * 60_000).toISOString() },
    });

    expect(created.status()).toBe(201);

    const { episodeId } = await created.json();
    const data = await (await page.request.get('/api/user/export?format=json')).json() as ExportJson;

    expect(data.tables.episode!.map(e => e.id)).toContain(episodeId);
  });

  test('leaves out credentials and never includes another user\'s data', async ({ page }) => {
    await query(
      `insert into doctor_share_link (user_id, token, label, expires_at)
       values ($1, 'e2e-secret-share-token', 'For Dr. E2E', now() + interval '7 days')`,
      [E2E_USER_ID],
    );
    await query(
      `insert into push_subscription (user_id, endpoint, p256dh, auth, user_agent)
       values ($1, 'https://push.example/e2e-secret-endpoint', 'e2e-secret-p256dh', 'e2e-secret-auth', 'E2E Browser')`,
      [E2E_USER_ID],
    );
    await query(
      `insert into episode (user_id, start_time, intensity, pain_location, pain_type, notes)
       values ($1, now(), 3, 'left', 'throbbing', 'e2e-other-user-private-note')`,
      [OTHER_USER_ID],
    );

    try {
      await page.goto(PRIVACY_PATH);
      const res = await page.request.get('/api/user/export?format=json');

      expect(res.status()).toBe(200);

      const body = await res.text();

      expect(body).not.toContain('e2e-secret');
      expect(body).not.toContain('e2e-other-user-private-note');
      expect(body).not.toContain(OTHER_USER_ID);

      const data = JSON.parse(body) as ExportJson;

      expect(data.tables.doctor_share_link).toEqual([expect.objectContaining({ label: 'For Dr. E2E' })]);
      expect(data.tables.doctor_share_link![0]).not.toHaveProperty('token');
      expect(data.tables.push_subscription).toEqual([expect.objectContaining({ userAgent: 'E2E Browser' })]);
    } finally {
      // e2e:reset only wipes the mock user's rows.
      await query('delete from episode where user_id = $1', [OTHER_USER_ID]);
    }
  });

  test('sets download headers and rejects unknown formats', async ({ page }) => {
    await page.goto(PRIVACY_PATH);

    const csv = await page.request.get('/api/user/export?format=csv');

    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toBe('application/zip');
    expect(csv.headers()['cache-control']).toContain('no-store');
    expect(csv.headers()['content-disposition']).toMatch(/^attachment; filename="migraine-club-export-.+-csv\.zip"$/);

    const bad = await page.request.get('/api/user/export?format=xml');

    expect(bad.status()).toBe(400);
  });
});
