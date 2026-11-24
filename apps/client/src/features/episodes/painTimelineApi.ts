'use client';

import { sendOrQueue } from '@/libs/offline/outbox';

export type PainReading = {
  id: string;
  episodeId: number;
  recordedAt: string;
  intensity: number;
};

export type PainReadingError = Error & { code?: string; reason?: string };

async function errorFrom(res: Response, fallback: string): Promise<PainReadingError> {
  const data = await res.json().catch(() => ({}));
  const err = new Error(data.error || fallback) as PainReadingError;
  err.code = data.code;
  err.reason = data.details?.reason;
  return err;
}

export async function fetchPainReadings(episodeId: number, args?: { signal?: AbortSignal }): Promise<PainReading[]> {
  const res = await fetch(`/api/episodes/${episodeId}/pain-readings`, { cache: 'no-store', signal: args?.signal });
  if (!res.ok) {
    throw await errorFrom(res, 'Failed to load pain timeline');
  }
  const data = await res.json();
  return Array.isArray(data?.readings) ? data.readings : [];
}

export type AddPainReadingResult
  = | { queued: true }
    | { queued: false; reading: PainReading; peakIntensity: number };

/**
 * Record the pain level at `recordedAt`. Works offline: the reading is queued
 * on the device with the captured time and synced later.
 */
export async function addPainReading(
  episodeId: number,
  input: { intensity: number; recordedAt: Date },
): Promise<AddPainReadingResult> {
  const result = await sendOrQueue({
    url: `/api/episodes/${episodeId}/pain-readings`,
    method: 'POST',
    body: { intensity: input.intensity, recordedAt: input.recordedAt.toISOString() },
    kind: 'attack_update',
  });
  if (result.queued) {
    return { queued: true };
  }
  if (!result.response.ok) {
    throw await errorFrom(result.response, 'Failed to save pain level');
  }
  const data = await result.response.json();
  return { queued: false, reading: data.reading, peakIntensity: data.peakIntensity };
}

/** Returns the attack's peak after the delete, or null when no readings remain. */
export async function deletePainReading(episodeId: number, readingId: string): Promise<number | null> {
  const res = await fetch(`/api/episodes/${episodeId}/pain-readings/${readingId}`, { method: 'DELETE' });
  if (!res.ok) {
    throw await errorFrom(res, 'Failed to delete pain reading');
  }
  const data = await res.json().catch(() => ({}));
  return typeof data?.peakIntensity === 'number' ? data.peakIntensity : null;
}
