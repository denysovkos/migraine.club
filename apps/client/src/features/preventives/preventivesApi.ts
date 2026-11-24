import type {
  CreatePreventivePlanInput,
  PreventiveIntakeUpsertInput,
  PreventiveStopInput,
  UpdatePreventivePlanInput,
} from '@/types/Preventives';

export type PreventiveDueResponse = {
  timezone: string;
  todayLocalDate: string;
  due: Array<{
    id: string;
    name: string;
    kind: string;
    scheduleLabel: string;
    isOverdue: boolean;
    state: 'taken' | 'missed' | 'unsure' | null;
  }>;
  notDue: Array<{
    id: string;
    name: string;
    kind: string;
    scheduleLabel: string;
  }>;
  hasActivePlans: boolean;
  insight: {
    adherencePct: number | null;
    migraineDays: number;
    from: string;
    to: string;
  } | null;
};

export type PreventivePlanListItem = {
  id: string;
  name: string;
  kind: string;
  doseText: string | null;
  scheduleType: string;
  schedulePayload: unknown;
  scheduleLabel: string;
  startDate: string;
  status: 'active' | 'paused' | 'stopped';
  pausedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  stopReasonNote: string | null;
  createdAt: string;
  updatedAt: string;
  reminderTimes: string[];
  remindersEnabled: boolean;
  isDuplicateName: boolean;
};

export type PreventivePlanSummary = {
  timezone: string;
  plan: {
    id: string;
    name: string;
    kind: string;
    doseText: string | null;
    scheduleLabel: string;
    scheduleType: string;
    schedulePayload: unknown;
    startDate: string;
    status: 'active' | 'paused' | 'stopped';
    reminderTimes: string[];
    remindersEnabled: boolean;
  };
  baseline: {
    from: string;
    to: string;
    mmd: number;
    mhd: number;
    acuteMedicationDays: number;
    coverage: { totalDays: number; recordedDays: number; missingDays: number };
  } | null;
  evaluation: {
    from: string;
    to: string;
    mmd: number;
    mhd: number;
    acuteMedicationDays: number;
    coverage: { totalDays: number; recordedDays: number; missingDays: number };
    percentChangeMmd: number | null;
    responder50: 'YES' | 'NO' | 'NA' | 'NOT_ENOUGH_DATA';
    missingDaysNeeded: number;
  } | null;
  evaluationLong: {
    from: string;
    to: string;
    mmd: number;
    mhd: number;
    acuteMedicationDays: number;
    coverage: { totalDays: number; recordedDays: number; missingDays: number };
  } | null;
  adherence: {
    last7: { dueDays: number; taken: number; missed: number; unsure: number; coverage: number };
    last28: { dueDays: number; taken: number; missed: number; unsure: number; coverage: number };
  };
  timelineWeeks: Array<{
    weekStart: string;
    migraineDays: number;
    adherence: number | null;
  }>;
};

export async function fetchPreventiveDue(localDate?: string): Promise<PreventiveDueResponse> {
  const url = new URL('/api/preventives/due', window.location.origin);
  if (localDate) {
    url.searchParams.set('localDate', localDate);
  }
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load preventives');
  }
  return res.json();
}

export async function listPreventivePlans(): Promise<PreventivePlanListItem[]> {
  const res = await fetch('/api/preventives', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load plans');
  }
  const data = await res.json();
  return data.plans ?? [];
}

export async function createPreventivePlan(input: CreatePreventivePlanInput): Promise<{ id: string }> {
  const res = await fetch('/api/preventives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create plan');
  }
  return res.json();
}

export async function updatePreventivePlan(id: string, patch: UpdatePreventivePlanInput): Promise<void> {
  const res = await fetch(`/api/preventives/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update plan');
  }
}

export async function deletePreventivePlan(id: string): Promise<void> {
  const res = await fetch(`/api/preventives/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete plan');
  }
}

export async function pausePreventivePlan(id: string): Promise<void> {
  const res = await fetch(`/api/preventives/${id}/pause`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to pause plan');
  }
}

export async function resumePreventivePlan(id: string): Promise<void> {
  const res = await fetch(`/api/preventives/${id}/resume`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to resume plan');
  }
}

export async function stopPreventivePlan(id: string, input: PreventiveStopInput): Promise<void> {
  const res = await fetch(`/api/preventives/${id}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to stop plan');
  }
}

export async function upsertPreventiveIntake(input: PreventiveIntakeUpsertInput): Promise<void> {
  const res = await fetch('/api/preventives/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to log intake');
  }
}

export async function fetchPreventiveSummary(id: string): Promise<PreventivePlanSummary> {
  const res = await fetch(`/api/preventives/${id}/summary`, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load plan summary');
  }
  return res.json();
}

export async function submitWeeklyCheckIn(id: string, payload: {
  weekStartLocalDate: string;
  sideEffects: 'none' | 'mild' | 'moderate' | 'severe';
  stillTaking: 'yes' | 'paused' | 'stopped';
  note?: string | null;
}): Promise<void> {
  const res = await fetch(`/api/preventives/${id}/weekly-checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to save check-in');
  }
}
