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

export async function quickAddStartEpisodeNow(args?: { signal?: AbortSignal }): Promise<{ episodeId: number }> {
  const attackType = getLastAttackType() ?? 'migraine';
  const res = await fetch('/api/quick-add/episode', {
    method: 'POST',
    signal: args?.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attackType }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || 'Failed to start episode') as any;
    err.code = data.code;
    err.ongoing = data.ongoing;
    throw err;
  }
  setLastAttackType(attackType);
  return res.json();
}

export async function quickAddCreateIntake(
  input: CreateQuickMedicationIntakeInput,
  args?: { signal?: AbortSignal },
): Promise<CreateQuickMedicationIntakeResponse> {
  const res = await fetch('/api/quick-add/medication-intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: args?.signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to log intake');
  }
  return res.json();
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
