'use client';

import type {
  CreateQuickMedicationIntakeInput,
  CreateQuickMedicationIntakeResponse,
  MedicationPickerIndexResponse,
  MedicationSearchResponse,
  QuickAddSuggestionsResponse,
  UpdateMedicationIntakeInput,
} from '@/types/Medications';
import { getLastAttackType, setLastAttackType } from '@/features/episodes/attackTypePrefs';
import { sendOrQueue } from '@/libs/offline/outbox';

export async function fetchQuickAddSuggestions(args?: { signal?: AbortSignal }): Promise<QuickAddSuggestionsResponse> {
  const res = await fetch('/api/quick-add/suggestions', { cache: 'no-store', signal: args?.signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load suggestions');
  }
  return res.json();
}

export async function fetchMedicationPickerIndex(args?: { signal?: AbortSignal }): Promise<MedicationPickerIndexResponse> {
  const res = await fetch('/api/user-medications', { cache: 'no-store', signal: args?.signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load medications');
  }
  return res.json();
}

export async function searchMedications(
  query: string,
  args?: { signal?: AbortSignal },
): Promise<MedicationSearchResponse> {
  const res = await fetch(`/api/medications/search?q=${encodeURIComponent(query)}`, {
    cache: 'no-store',
    signal: args?.signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to search medications');
  }
  return res.json();
}

export type QueuedOffline = { queued: true; outboxId: string };

async function errorFrom(res: Response, fallback: string): Promise<Error & { code?: string; ongoing?: unknown }> {
  const data = await res.json().catch(() => ({}));
  const err = new Error(data.error || fallback) as Error & { code?: string; ongoing?: unknown };
  err.code = data.code;
  err.ongoing = data.ongoing;
  return err;
}

/**
 * Start an attack now. Works offline: the attack is queued on the device with
 * the time of the tap and synced later.
 */
export async function quickAddStartEpisodeNow(args?: {
  signal?: AbortSignal;
  attackType?: 'migraine' | 'headache';
  /** Past local day (YYYY-MM-DD): log a finished attack on that day instead. */
  localDate?: string;
}): Promise<{ queued: false; episodeId: number } | QueuedOffline> {
  const attackType = args?.attackType ?? getLastAttackType() ?? 'migraine';
  const result = await sendOrQueue({
    url: '/api/quick-add/episode',
    method: 'POST',
    body: args?.localDate
      ? { attackType, localDate: args.localDate }
      : { attackType, startedAt: new Date().toISOString() },
    kind: 'attack',
    signal: args?.signal,
  });
  setLastAttackType(attackType);
  if (result.queued) {
    return { queued: true, outboxId: result.id };
  }
  if (!result.response.ok) {
    throw await errorFrom(result.response, 'Failed to start episode');
  }
  const data = await result.response.json();
  return { queued: false, episodeId: data.episodeId };
}

/**
 * Log a medication intake (and, with recordAcuteDose, the acute dose) in one
 * request. Works offline: queued with the time of the tap.
 */
export async function quickAddCreateIntake(
  input: CreateQuickMedicationIntakeInput,
  args?: { signal?: AbortSignal; label?: string | null },
): Promise<(CreateQuickMedicationIntakeResponse & { queued: false }) | QueuedOffline> {
  const result = await sendOrQueue({
    url: '/api/quick-add/medication-intake',
    method: 'POST',
    body: { ...input, takenAt: input.takenAt ?? new Date().toISOString() },
    kind: 'dose',
    label: args?.label ?? input.customName ?? null,
    signal: args?.signal,
  });
  if (result.queued) {
    return { queued: true, outboxId: result.id };
  }
  if (!result.response.ok) {
    throw await errorFrom(result.response, 'Failed to log intake');
  }
  return { ...(await result.response.json()), queued: false };
}

export async function quickAddUndoIntake(intakeId: string): Promise<void> {
  const res = await fetch(`/api/quick-add/medication-intake/${intakeId}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to undo');
  }
}

export async function quickAddUpdateIntake(intakeId: string, input: UpdateMedicationIntakeInput): Promise<void> {
  const res = await fetch(`/api/quick-add/medication-intake/${intakeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update intake');
  }
}

export async function deleteEpisode(episodeId: number): Promise<void> {
  const res = await fetch(`/api/episodes/${episodeId}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete episode');
  }
}
