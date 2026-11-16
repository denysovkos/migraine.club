'use client';

export async function createAcuteDose(input: {
  medicationId: string;
  attackId?: number | null;
  dose?: string | null;
  unit?: string | null;
  unitIsCustom?: boolean;
}) {
  const res = await fetch('/api/acute-doses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to log dose');
  }
  return res.json() as Promise<{ doseId: string; attackId: number | null }>;
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
