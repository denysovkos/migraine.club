import type { ProgramSettingsDTO } from '@/services/programs/programSettingsService';

export type ProgramSummary = {
  id: string;
  title: string;
  shape: 'daily-habit' | 'per-attack-rule';
  durationWeeks: number;
  citationCount: number;
};

export type EnrollmentDTO = {
  id: number;
  userId: string;
  programId: string;
  status: 'active' | 'paused' | 'ended';
  targetPayload: { bedTime: string; wakeTime: string; toleranceMinutes: number } | Record<string, unknown>;
  startDate: string;
  endDate: string | null;
  baselineWindowStart: string;
  baselineWindowEnd: string;
  evaluationWindowStart: string;
  evaluationWindowEnd: string;
  rampDays: number;
  timezone: string;
};

export type SleepDefaultTarget = { bedTime: string; wakeTime: string; toleranceMinutes: number };
export type AcuteDefaultTarget = { acuteWindowMinutes: number };

export type ProgramDetailDTO = {
  id: string;
  title: string;
  shape: 'daily-habit' | 'per-attack-rule';
  durationWeeks: number;
  defaultTarget: SleepDefaultTarget | AcuteDefaultTarget;
  citations: { id: string; label: string; doi?: string; pmid?: string; url?: string }[];
  disclaimer: string;
  body: string;
  activeEnrollment: EnrollmentDTO | null;
};

export async function fetchProgramSettings(): Promise<ProgramSettingsDTO> {
  const res = await fetch('/api/programs/settings', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load program settings');
  }
  return res.json();
}

export async function updateProgramSettings(
  patch: Partial<Pick<ProgramSettingsDTO, 'enabled' | 'notificationsConfig'>>,
): Promise<ProgramSettingsDTO> {
  const res = await fetch('/api/programs/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error('Failed to update program settings');
  }
  return res.json();
}

export async function fetchPrograms(): Promise<{ programs: ProgramSummary[] }> {
  const res = await fetch('/api/programs', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load programs');
  }
  return res.json();
}

export async function fetchProgramDetail(programId: string, locale?: string): Promise<ProgramDetailDTO> {
  const url = locale
    ? `/api/programs/${programId}?locale=${encodeURIComponent(locale)}`
    : `/api/programs/${programId}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load program');
  }
  return res.json();
}

export async function enrollInProgram(
  programId: string,
  targetPayload: SleepDefaultTarget | AcuteDefaultTarget,
): Promise<EnrollmentDTO> {
  const res = await fetch(`/api/programs/${programId}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetPayload }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? 'Enroll failed');
  }
  return res.json();
}

export async function pauseEnrollment(programId: string, enrollmentId: number) {
  const res = await fetch(`/api/programs/${programId}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentId }),
  });
  if (!res.ok) {
    throw new Error('Pause failed');
  }
  return res.json();
}

export async function resumeEnrollment(programId: string, enrollmentId: number) {
  const res = await fetch(`/api/programs/${programId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentId }),
  });
  if (!res.ok) {
    throw new Error('Resume failed');
  }
  return res.json();
}

export type ProgressDTO = {
  enrollment: EnrollmentDTO;
  summary: {
    adherence: number;
    coverage: number;
    evalComplete: boolean;
    evalDaysPassed: number;
    baselineCoverage: number;
    comparison: {
      baseline: { headacheDays: number; totalDays: number };
      evaluation: { headacheDays: number; totalDays: number };
      percentChange: number;
      directionLabel: 'reduced' | 'increased' | 'no_change';
    };
  };
  confidence: 'low' | 'medium' | 'high';
};

export async function fetchProgramProgress(programId: string): Promise<ProgressDTO> {
  const res = await fetch(`/api/programs/${programId}/progress`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load progress');
  }
  return res.json();
}

export async function fetchEnrollments(): Promise<{ enrollments: EnrollmentDTO[] }> {
  const res = await fetch('/api/programs/enrollments', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load enrollments');
  }
  return res.json();
}

export async function endEnrollment(programId: string, enrollmentId: number) {
  const res = await fetch(`/api/programs/${programId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentId }),
  });
  if (!res.ok) {
    throw new Error('End failed');
  }
  return res.json();
}

export async function logSleepAdherence(args: {
  localDate: string;
  bedTimeLocal: string | null;
  wakeTimeLocal: string | null;
}): Promise<void> {
  const res = await fetch('/api/programs/sleep-regularity/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error('Log adherence failed');
  }
}
