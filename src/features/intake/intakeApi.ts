import type { IntakeBlockPatch } from '@/models/intake';
import type { IntakeDTO } from '@/services/intake/IntakeService';

export async function fetchIntake(): Promise<IntakeDTO> {
  const res = await fetch('/api/intake', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`intake fetch failed: ${res.status}`);
  }
  return res.json();
}

export async function patchIntakeBlock(patch: IntakeBlockPatch): Promise<IntakeDTO> {
  const res = await fetch('/api/intake', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`intake patch failed: ${res.status}`);
  }
  return res.json();
}

export async function skipIntake(): Promise<void> {
  const res = await fetch('/api/intake/skip', { method: 'POST' });
  if (!res.ok) {
    throw new Error(`intake skip failed: ${res.status}`);
  }
}

export async function completeIntake(): Promise<void> {
  const res = await fetch('/api/intake/complete', { method: 'POST' });
  if (!res.ok) {
    throw new Error(`intake complete failed: ${res.status}`);
  }
}
