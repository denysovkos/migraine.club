import type { SolarActivitySnapshot } from '@/types/WeatherPainIndex';
import axios from 'axios';

import { and, asc, desc, eq, gt, gte, lte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { solarActivitySnapshotSchema } from '@/models/Schema';

// NOAA Kp index response (JSON format)
// Each entry: [timestamp, Kp, Kp_text, observed/estimated]
// Example: ["2024-01-01 00:00:00.000", "2.33", "", "observed"]
type NOAAKpEntry = [string, string, string, string];

// NOAA planetary K-index endpoint
const NOAA_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';

// Check if the latest snapshot is recent enough (7 hours)
function isRecent(timestampUtc: Date): boolean {
  const now = new Date();
  const sevenHoursAgo = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  return timestampUtc > sevenHoursAgo;
}

export class SolarActivityRepository {
  /**
   * Get the latest Kp index from the database
   * Data is synced by an external cron every 6 hours
   */
  async getLatestKpIndex(): Promise<SolarActivitySnapshot | null> {
    const [latest] = await db
      .select()
      .from(solarActivitySnapshotSchema)
      .where(eq(solarActivitySnapshotSchema.source, 'noaa'))
      .orderBy(desc(solarActivitySnapshotSchema.timestampUtc))
      .limit(1);

    if (!latest) {
      return null;
    }

    if (!isRecent(latest.timestampUtc)) {
      logger.warn('Using stale Kp index data (cron job may need attention)');
    }

    return {
      kpIndex: latest.kpIndex,
      timestampUtc: latest.timestampUtc,
      source: 'noaa',
    };
  }

  /**
   * Get the latest Kp snapshot at or before a given timestamp (best "current" value)
   */
  async getLatestSnapshotAtOrBefore(timestamp: Date): Promise<SolarActivitySnapshot | null> {
    const [latest] = await db
      .select()
      .from(solarActivitySnapshotSchema)
      .where(
        and(
          eq(solarActivitySnapshotSchema.source, 'noaa'),
          lte(solarActivitySnapshotSchema.timestampUtc, timestamp),
        ),
      )
      .orderBy(desc(solarActivitySnapshotSchema.timestampUtc))
      .limit(1);

    if (!latest) {
      return null;
    }

    if (!isRecent(latest.timestampUtc)) {
      logger.warn('Using stale Kp index data (cron job may need attention)');
    }

    return {
      kpIndex: latest.kpIndex,
      timestampUtc: latest.timestampUtc,
      source: 'noaa',
    };
  }

  /**
   * Find the next snapshot after a given timestamp where Kp >= threshold.
   * Useful for detecting upcoming "high episodes" in the data we already have.
   */
  async getNextHighSnapshot(afterTimestamp: Date, threshold: number): Promise<SolarActivitySnapshot | null> {
    const [next] = await db
      .select()
      .from(solarActivitySnapshotSchema)
      .where(
        and(
          eq(solarActivitySnapshotSchema.source, 'noaa'),
          gt(solarActivitySnapshotSchema.timestampUtc, afterTimestamp),
          gte(solarActivitySnapshotSchema.kpIndex, threshold),
        ),
      )
      .orderBy(asc(solarActivitySnapshotSchema.timestampUtc))
      .limit(1);

    if (!next) {
      return null;
    }

    return {
      kpIndex: next.kpIndex,
      timestampUtc: next.timestampUtc,
      source: 'noaa',
    };
  }

  /**
   * Sync solar activity data from NOAA (called by cron job)
   * Only inserts new unique records
   */
  async syncFromNOAA(): Promise<{ fetched: number; inserted: number }> {
    try {
      return await this.fetchFromNOAA();
    } catch (error) {
      logger.error({ error }, 'Failed to sync Kp index from NOAA');
      throw error;
    }
  }

  /**
   * Fetch Kp index data from NOAA and store unique records in database
   * Returns counts of fetched and newly inserted records
   */
  private async fetchFromNOAA(): Promise<{ fetched: number; inserted: number }> {
    const response = await axios.get<NOAAKpEntry[]>(NOAA_KP_URL, {
      timeout: 10000,
    });

    const data = response.data;
    if (!Array.isArray(data) || data.length < 2) {
      logger.warn('Invalid NOAA Kp response format');
      return { fetched: 0, inserted: 0 };
    }

    // Skip header row (first element)
    const entries = data.slice(1);

    let fetched = 0;
    let inserted = 0;

    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }

      const [timestampStr, kpStr] = entry;
      if (!timestampStr || !kpStr) {
        continue;
      }

      const timestampUtc = new Date(`${timestampStr.replace(' ', 'T')}Z`);
      const kpIndex = Number.parseFloat(kpStr);

      if (Number.isNaN(timestampUtc.getTime()) || Number.isNaN(kpIndex)) {
        continue;
      }

      fetched++;

      // Insert into database (ignore conflicts for existing records)
      try {
        const result = await db
          .insert(solarActivitySnapshotSchema)
          .values({
            timestampUtc,
            kpIndex,
            source: 'noaa',
            raw: { originalEntry: entry },
          })
          .onConflictDoNothing()
          .returning({ id: solarActivitySnapshotSchema.id });

        if (result.length > 0) {
          inserted++;
        }
      } catch (error) {
        // Ignore duplicate errors
        logger.debug({ error, timestampUtc }, 'Solar snapshot insert failed');
      }
    }

    logger.info({ fetched, inserted }, 'NOAA data processed');
    return { fetched, inserted };
  }

  /**
   * Get solar activity snapshots for a date range
   */
  async getSnapshotsInRange(startDate: Date, endDate: Date): Promise<SolarActivitySnapshot[]> {
    const snapshots = await db
      .select()
      .from(solarActivitySnapshotSchema)
      .where(
        and(
          eq(solarActivitySnapshotSchema.source, 'noaa'),
          gte(solarActivitySnapshotSchema.timestampUtc, startDate),
          lte(solarActivitySnapshotSchema.timestampUtc, endDate),
        ),
      )
      .orderBy(asc(solarActivitySnapshotSchema.timestampUtc));

    return snapshots.map(s => ({
      kpIndex: s.kpIndex,
      timestampUtc: s.timestampUtc,
      source: 'noaa' as const,
    }));
  }

  /**
   * Find the closest Kp snapshot to a given timestamp
   */
  async getClosestKpSnapshot(timestamp: Date): Promise<SolarActivitySnapshot | null> {
    // Get all snapshots within 6 hours of the timestamp
    const sixHours = 6 * 60 * 60 * 1000;
    const startTime = new Date(timestamp.getTime() - sixHours);
    const endTime = new Date(timestamp.getTime() + sixHours);

    const snapshots = await this.getSnapshotsInRange(startTime, endTime);

    if (snapshots.length === 0) {
      return null;
    }

    // Find the closest one
    let closest = snapshots[0]!;
    let minDiff = Math.abs(timestamp.getTime() - closest.timestampUtc.getTime());

    for (const snapshot of snapshots) {
      const diff = Math.abs(timestamp.getTime() - snapshot.timestampUtc.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closest = snapshot;
      }
    }

    return closest;
  }
}

// Singleton instance
export const solarActivityRepository = new SolarActivityRepository();
