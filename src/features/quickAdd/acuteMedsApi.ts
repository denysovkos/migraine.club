'use client';

import { sendOrQueue } from '@/libs/offline/outbox';

/**
 * Log an acute dose. Works offline: queued with the time of the tap.
 */
export async function createAcuteDose(input: {
  medicationId: string;
  attackId?: number | null;
  dose?: string | null;
  unit?: string | null;
  unitIsCustom?: boolean;
  label?: string | null;
}): Promise<{ queued: false; doseId: string; attackId: number | null } | { queued: true; outboxId: string }> {
  const { label, ...payload } = input;
  const result = await sendOrQueue({
    url: '/api/acute-doses',
    method: 'POST',
    body: { ...payload, takenAt: new Date().toISOString() },
    kind: 'dose',
    label: label ?? null,
  });
  if (result.queued) {
    return { queued: true, outboxId: result.id };
  }
  if (!result.response.ok) {
    const data = await result.response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to log dose');
  }
  return { ...(await result.response.json()), queued: false };
}

export async function upsertDoseOutcome(input: {
  doseId: string;
  helped: 'yes' | 'partly' | 'no';
  backToNormalFunction?: boolean | null;
  timeToReliefMinutes?: number | null;
}) {
  const res = await fetch('/api/dose-outcomes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to save outcome');
  }
  return res.json() as Promise<{ outcomeId: string; doseId: string }>;
}

export async function fetchMohStatus() {
  const res = await fetch('/api/moh-status', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load MOH status');
  }
  return res.json() as Promise<{
    status: 'ok' | 'approaching' | 'exceeded';
    perClass: Array<{
      medicationClass: string;
      rolling30DaysUsed: number;
      threshold: number;
      status: 'ok' | 'approaching' | 'exceeded';
    }>;
    message: string;
  }>;
}
