import type { AppointmentPrepSnapshot } from '@migraine/db/appointmentPrep';
import { requestClinicianReportPdf } from '@/features/reports/clinician/clinicianPdf';

export type AppointmentPrepDraftListItem = {
  id: string;
  appointmentDate: string;
  visitLabel: string | null;
  clinicianName: string | null;
  visitReason: string | null;
  topConcerns: string[];
  doctorQuestions: string[];
  personalNotes: string | null;
  compareWindowDays: number;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentPrepDraft = AppointmentPrepDraftListItem & {
  generatedSnapshot: AppointmentPrepSnapshot;
};

export type AppointmentPrepDraftPatch = Partial<{
  appointmentDate: string;
  visitLabel: string | null;
  clinicianName: string | null;
  visitReason: string | null;
  topConcerns: string[];
  doctorQuestions: string[];
  personalNotes: string | null;
}>;

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit, errorMessage = 'Request failed'): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(errorMessage);
  }
  return response.json() as Promise<T>;
}

export function listAppointmentPreps(): Promise<AppointmentPrepDraftListItem[]> {
  return requestJson<{ drafts: AppointmentPrepDraftListItem[] }>(
    '/api/appointment-preps',
    { cache: 'no-store' },
    'Failed to load appointment prep drafts',
  ).then(payload => payload.drafts);
}

export function createAppointmentPrep(input: {
  appointmentDate: string;
  visitLabel?: string;
  clinicianName?: string;
  visitReason?: string;
  topConcerns?: string[];
  doctorQuestions?: string[];
  personalNotes?: string;
}): Promise<{ id: string }> {
  return requestJson('/api/appointment-preps', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }, 'Failed to create appointment prep draft');
}

export function getAppointmentPrep(id: string): Promise<AppointmentPrepDraft> {
  return requestJson<{ draft: AppointmentPrepDraft }>(
    `/api/appointment-preps/${id}`,
    { cache: 'no-store' },
    'Failed to load appointment prep draft',
  ).then(payload => payload.draft);
}

export function updateAppointmentPrep(id: string, patch: AppointmentPrepDraftPatch): Promise<AppointmentPrepDraft> {
  return requestJson<{ draft: AppointmentPrepDraft }>(
    `/api/appointment-preps/${id}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    },
    'Failed to save appointment prep draft',
  ).then(payload => payload.draft);
}

export function deleteAppointmentPrep(id: string): Promise<{ ok: true }> {
  return requestJson(
    `/api/appointment-preps/${id}`,
    {
      method: 'DELETE',
    },
    'Failed to delete appointment prep draft',
  );
}

export async function createAppointmentPrepShareLink(prepId: string): Promise<string> {
  const payload = await requestJson<{ token: string }>('/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appointmentPrepId: prepId,
      expiresInDays: 14,
      label: 'Appointment prep share',
    }),
  }, 'Failed to create doctor share link');

  if (typeof window === 'undefined') {
    return `/share/${payload.token}`;
  }

  return `${window.location.origin}/share/${payload.token}`;
}

export async function exportAppointmentPrepPdf(prepId: string): Promise<Blob> {
  const response = await requestClinicianReportPdf({
    template: 'quick',
    rangePreset: 'last90',
    appointmentPrepId: prepId,
  });
  if (!response.ok) {
    throw new Error('Failed to export appointment prep PDF');
  }
  return response.blob();
}
