'use client';

import type { AttackPainChoice } from './attackModeLogic';
import type { QuickAddSuggestion } from '@/types/Medications';
import { fetchOngoingEpisode } from '@/features/dashboard/migrennity/dataHelpers';
import { sendOrQueue } from '@/libs/offline/outbox';
import { limitMeds, painChoiceToIntensity } from './attackModeLogic';

export type AttackModeOngoing = {
  id: number;
  startTime: string;
  intensity: number | null;
};

export type AttackModeState
  = | { status: 'ready'; ongoing: AttackModeOngoing | null; meds: QuickAddSuggestion[] }
    | { status: 'consent_required' };

/**
 * Everything attack mode needs in one call: the ongoing attack (if any) and
 * the user's most used medications. Suggestions failing for any reason other
 * than missing consent just means no medication shortcuts are offered.
 */
export async function fetchAttackModeState(args?: { signal?: AbortSignal }): Promise<AttackModeState> {
  const [ongoing, suggestionsRes] = await Promise.all([
    fetchOngoingEpisode().catch(() => null),
    fetch('/api/quick-add/suggestions', { cache: 'no-store', signal: args?.signal }).catch(() => null),
  ]);

  let meds: QuickAddSuggestion[] = [];
  if (suggestionsRes) {
    if (suggestionsRes.status === 403) {
      const data = await suggestionsRes.json().catch(() => ({}));
      if (data?.code === 'CONSENT_REQUIRED') {
        return { status: 'consent_required' };
      }
    } else if (suggestionsRes.ok) {
      const data = await suggestionsRes.json().catch(() => ({}));
      meds = limitMeds(Array.isArray(data?.topMeds) ? data.topMeds : []);
    }
  }

  // "Now" is the latest pain reading; the attack's stored intensity is its peak.
  const latest = ongoing ? await fetchLatestPainIntensity(ongoing.id, args?.signal) : null;

  return {
    status: 'ready',
    ongoing: ongoing
      ? {
          id: ongoing.id,
          startTime: new Date(ongoing.startTime as unknown as string).toISOString(),
          intensity: latest ?? (typeof ongoing.intensity === 'number' ? ongoing.intensity : null),
        }
      : null,
    meds,
  };
}

async function fetchLatestPainIntensity(episodeId: number, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(`/api/episodes/${episodeId}/pain-readings`, { cache: 'no-store', signal });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    const readings = Array.isArray(data?.readings) ? data.readings : [];
    const last = readings.at(-1);
    return typeof last?.intensity === 'number' ? last.intensity : null;
  } catch {
    return null;
  }
}

async function patchEpisode(episodeId: number, body: Record<string, unknown>, fallback: string) {
  const result = await sendOrQueue({
    url: `/api/episodes/${episodeId}`,
    method: 'PATCH',
    body,
    kind: 'attack_update',
  });
  if (result.queued) {
    return { queued: true as const };
  }
  if (!result.response.ok) {
    const data = await result.response.json().catch(() => ({}));
    throw new Error(data.error || fallback);
  }
  return { queued: false as const };
}

/**
 * End the attack now. `endedAt` carries the time of the tap so an entry that
 * waits in the offline queue still ends at the right moment.
 */
export function endAttackNow(episodeId: number, now: Date = new Date()) {
  return patchEpisode(episodeId, { endNow: true, endedAt: now.toISOString() }, 'Failed to end attack');
}

/**
 * Record the pain level now as a point on the attack's pain timeline. The
 * server raises the attack's peak intensity when this reading exceeds it.
 * `recordedAt` is the time of the tap, so a queued reading keeps its place.
 */
export async function setAttackPain(episodeId: number, choice: AttackPainChoice, now: Date = new Date()) {
  const result = await sendOrQueue({
    url: `/api/episodes/${episodeId}/pain-readings`,
    method: 'POST',
    body: { intensity: painChoiceToIntensity(choice), recordedAt: now.toISOString() },
    kind: 'attack_update',
  });
  if (result.queued) {
    return { queued: true as const };
  }
  if (!result.response.ok) {
    const data = await result.response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to save pain level');
  }
  return { queued: false as const };
}
