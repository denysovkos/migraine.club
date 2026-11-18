import { Buffer } from 'node:buffer';

import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectedColumns: Record<string, string[]> = {};
const rowsByTable: Record<string, Record<string, unknown>[]> = {};

vi.mock('@/libs/DB', () => {
  return {
    db: {
      select: vi.fn((columns: Record<string, unknown>) => ({
        from: vi.fn((table: any) => {
          const name = getTableName(table);
          selectedColumns[name] = Object.keys(columns);
          const rows = async () => rowsByTable[name] ?? [];
          return {
            where: vi.fn(() => ({
              orderBy: vi.fn(rows),
              then: (resolve: any, reject: any) => rows().then(resolve, reject),
            })),
          };
        }),
      })),
    },
  };
});

describe('DataExportService', () => {
  beforeEach(() => {
    for (const key of Object.keys(selectedColumns)) {
      delete selectedColumns[key];
    }
    for (const key of Object.keys(rowsByTable)) {
      delete rowsByTable[key];
    }
  });

  it('includes the pain readings of each attack', async () => {
    rowsByTable.episode_pain_reading = [{ id: 'r1', episodeId: 1, intensity: 4 }];
    const { collectUserData } = await import('./DataExportService');

    const data = await collectUserData('user_1', new Date('2026-11-17T08:00:00Z'));

    expect(data.tables.episode_pain_reading).toEqual([{ id: 'r1', episodeId: 1, intensity: 4 }]);
    expect(selectedColumns.episode_pain_reading).toEqual(
      expect.arrayContaining(['episodeId', 'recordedAt', 'intensity']),
    );
  });

  it('includes relief sessions with the "did it help" answer', async () => {
    rowsByTable.relief_session = [{ id: 's1', exercise: 'breathing', helped: 'yes' }];
    const { collectUserData } = await import('./DataExportService');

    const data = await collectUserData('user_1', new Date('2026-11-17T08:00:00Z'));

    expect(data.tables.relief_session).toEqual([{ id: 's1', exercise: 'breathing', helped: 'yes' }]);
    expect(selectedColumns.relief_session).toEqual(
      expect.arrayContaining(['episodeId', 'exercise', 'startedAt', 'durationSeconds', 'completed', 'helped']),
    );
  });

  it('collects user tables and leaves out credentials and staff-only fields', async () => {
    rowsByTable.episode = [{ id: 1, intensity: 7, notes: 'bad one' }];
    rowsByTable.doctor_verification_application = [{ id: 'app-1', status: 'pending' }];
    rowsByTable.doctor_verification_file = [{ id: 'file-1', originalName: 'license.pdf' }];
    const { collectUserData } = await import('./DataExportService');

    const data = await collectUserData('user_1', new Date('2026-11-17T08:00:00Z'));

    expect(data.exportedAt).toBe('2026-11-17T08:00:00.000Z');
    expect(data.userId).toBe('user_1');
    expect(data.tables.episode).toEqual([{ id: 1, intensity: 7, notes: 'bad one' }]);
    expect(data.tables.daily_diary_entry).toEqual([]);
    expect(data.tables.doctor_verification_file).toEqual([{ id: 'file-1', originalName: 'license.pdf' }]);

    expect(selectedColumns.user).not.toContain('stripeCustomerId');
    expect(selectedColumns.user).toContain('displayName');
    expect(selectedColumns.doctor_share_link).not.toContain('token');
    expect(selectedColumns.push_subscription).not.toContain('endpoint');
    expect(selectedColumns.push_subscription).not.toContain('p256dh');
    expect(selectedColumns.push_subscription).not.toContain('auth');
    expect(selectedColumns.doctor_verification_application).not.toContain('adminNotes');
    expect(selectedColumns.doctor_verification_file).not.toContain('relativePath');

    // Global and derived tables are not part of a personal export.
    expect(data.tables).not.toHaveProperty('medications_catalog');
    expect(data.tables).not.toHaveProperty('insights_cache');
    expect(data.tables).not.toHaveProperty('idempotent_request');
  });

  it('skips the verification file lookup when there is no application', async () => {
    const { collectUserData } = await import('./DataExportService');

    const data = await collectUserData('user_1');

    expect(data.tables.doctor_verification_file).toEqual([]);
    expect(selectedColumns).not.toHaveProperty('doctor_verification_file');
  });

  it('builds a CSV archive with a manifest of row counts', async () => {
    const { buildCsvArchive } = await import('./DataExportService');
    const archive = Buffer.from(buildCsvArchive({
      format: 'migraine.club/user-data-export',
      formatVersion: '1',
      exportedAt: '2026-11-17T08:00:00.000Z',
      userId: 'user_1',
      tables: { episode: [{ id: 1, intensity: 7 }], daily_diary_entry: [] },
    }));

    const text = archive.toString('latin1');

    expect(text).toContain('README.txt');
    expect(text).toContain('manifest.json');
    expect(text).toContain('episode.csv');
    expect(text).toContain('daily_diary_entry.csv');
  });
});
