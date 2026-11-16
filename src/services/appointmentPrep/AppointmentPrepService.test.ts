import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const selectResults: any[][] = [];
const insertResults: any[][] = [];

const insertValuesSpy = vi.fn();
const updateSetSpy = vi.fn();
const deleteWhereSpy = vi.fn();
const computeOutcomesForRangeMock = vi.fn();

vi.mock('@/libs/DB', () => {
  const makeSelection = () => {
    const selection: any = {
      leftJoin: vi.fn(() => selection),
      where: vi.fn(() => selection),
      orderBy: vi.fn(() => selection),
      limit: vi.fn(async () => selectResults.shift() ?? []),
    };
    return selection;
  };

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => makeSelection()),
      })),
      insert: vi.fn(() => ({
        values: (values: any) => {
          insertValuesSpy(values);
          return {
            returning: vi.fn(async () => insertResults.shift() ?? []),
          };
        },
      })),
      update: vi.fn(() => ({
        set: (values: any) => {
          updateSetSpy(values);
          return {
            where: vi.fn(async () => []),
          };
        },
      })),
      delete: vi.fn(() => ({
        where: vi.fn(async (...args: any[]) => {
          deleteWhereSpy(...args);
          return [];
        }),
      })),
    },
  };
});

vi.mock('@/services/userTimezone', () => ({
  getUserTimezone: vi.fn(async () => 'UTC'),
}));

vi.mock('@/services/outcomes/computeOutcomes', () => ({
  computeOutcomesForRange: computeOutcomesForRangeMock,
}));

describe('AppointmentPrepService', () => {
  beforeEach(() => {
    selectResults.length = 0;
    insertResults.length = 0;
    insertValuesSpy.mockClear();
    updateSetSpy.mockClear();
    deleteWhereSpy.mockClear();
    computeOutcomesForRangeMock.mockReset();
    computeOutcomesForRangeMock.mockReturnValue({
      windowDays: 90,
      timezone: 'UTC',
      totals: {
        mmdMin: 6,
        mmdMax: 8,
        mhdMin: 10,
        mhdMax: 12,
        acuteMedicationDays: 4,
        coverage: { totalDays: 90, recordedDays: 72, missingDays: 18 },
      },
      daily: [],
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a draft with the default compare window ending today in the user timezone', async () => {
    selectResults.push([
      { localDate: new Date('2026-04-03T00:00:00.000Z'), dayType: 'migraine_day' },
      { localDate: new Date('2026-04-04T00:00:00.000Z'), dayType: 'headache_day' },
    ]);
    selectResults.push([
      { takenAt: new Date('2026-04-03T12:00:00.000Z'), medicationName: 'Triptan' },
      { takenAt: new Date('2026-04-04T12:00:00.000Z'), medicationName: 'Ibuprofen' },
    ]);
    selectResults.push([
      { type: 'HIT6', scoreTotal: 61, takenAt: new Date('2026-04-02T10:00:00.000Z') },
      { type: 'MIDAS', scoreTotal: 18, takenAt: new Date('2026-03-18T10:00:00.000Z') },
    ]);
    selectResults.push([
      { name: 'Topiramate' },
      { name: 'Magnesium' },
    ]);
    selectResults.push([
      { intensity: 4 },
      { intensity: 6 },
    ]);
    insertResults.push([{ id: '00000000-0000-0000-0000-000000000123' }]);

    const outcomesModule = await import('@/services/outcomes/computeOutcomes');
    const { appointmentPrepService } = await import('./AppointmentPrepService');
    const result = await appointmentPrepService.createDraft('user-1', {
      appointmentDate: '2026-05-20',
      visitLabel: 'Neurology follow-up',
      clinicianName: 'Dr. Rivera',
      visitReason: 'Review headache control',
      topConcerns: ['frequent attacks'],
      doctorQuestions: ['What should we change?'],
      personalNotes: 'Bring tracker notes.',
    });

    expect(result).toEqual({ id: '00000000-0000-0000-0000-000000000123' });
    expect(outcomesModule.computeOutcomesForRange).toHaveBeenCalledWith(
      expect.objectContaining({
        windowDays: 90,
        from: '2026-01-16',
        to: '2026-04-15',
        diaryDays: [
          { localDate: '2026-04-03', dayType: 'migraine_day' },
          { localDate: '2026-04-04', dayType: 'headache_day' },
        ],
        medicationIntakes: [
          { takenAt: new Date('2026-04-03T12:00:00.000Z'), name: 'Triptan' },
          { takenAt: new Date('2026-04-04T12:00:00.000Z'), name: 'Ibuprofen' },
        ],
      }),
    );
    expect(insertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        appointmentDate: new Date('2026-05-20T00:00:00.000Z'),
        compareWindowDays: 90,
        generatedSnapshot: expect.objectContaining({
          compareWindowDays: 90,
          coverage: { totalDays: 90, recordedDays: 72, missingDays: 18 },
          attackStats: { totalAttacks: 2, avgIntensity: 5 },
        }),
      }),
    );
  });

  it('lists drafts for the current user in newest-first order', async () => {
    selectResults.push([
      {
        id: 'draft-2',
        appointmentDate: new Date('2026-05-10T00:00:00.000Z'),
        visitLabel: 'Follow-up',
        clinicianName: 'Dr. B',
        visitReason: null,
        topConcerns: ['pain'],
        doctorQuestions: [],
        personalNotes: null,
        compareWindowDays: 90,
        createdAt: new Date('2026-04-03T12:00:00.000Z'),
        updatedAt: new Date('2026-04-03T12:00:00.000Z'),
      },
      {
        id: 'draft-1',
        appointmentDate: new Date('2026-04-20T00:00:00.000Z'),
        visitLabel: 'Initial',
        clinicianName: 'Dr. A',
        visitReason: 'Consult',
        topConcerns: [],
        doctorQuestions: ['What now?'],
        personalNotes: 'notes',
        compareWindowDays: 120,
        createdAt: new Date('2026-04-01T12:00:00.000Z'),
        updatedAt: new Date('2026-04-02T12:00:00.000Z'),
      },
    ]);

    const { appointmentPrepService } = await import('./AppointmentPrepService');
    const drafts = await appointmentPrepService.listDrafts('user-1');

    expect(drafts).toEqual([
      {
        id: 'draft-2',
        appointmentDate: '2026-05-10',
        visitLabel: 'Follow-up',
        clinicianName: 'Dr. B',
        visitReason: null,
        topConcerns: ['pain'],
        doctorQuestions: [],
        personalNotes: null,
        compareWindowDays: 90,
        createdAt: '2026-04-03T12:00:00.000Z',
        updatedAt: '2026-04-03T12:00:00.000Z',
      },
      {
        id: 'draft-1',
        appointmentDate: '2026-04-20',
        visitLabel: 'Initial',
        clinicianName: 'Dr. A',
        visitReason: 'Consult',
        topConcerns: [],
        doctorQuestions: ['What now?'],
        personalNotes: 'notes',
        compareWindowDays: 120,
        createdAt: '2026-04-01T12:00:00.000Z',
        updatedAt: '2026-04-02T12:00:00.000Z',
      },
    ]);
  });

  it('returns an owned draft with its generated snapshot', async () => {
    const snapshot = {
      compareWindowDays: 90,
      coverage: { totalDays: 90, recordedDays: 72, missingDays: 18 },
      attackStats: { totalAttacks: 2, avgIntensity: 5 },
      currentSnapshot: {
        headacheBurden: { migraineDays: 6, headacheDays: 10 },
        acuteMedicationDays: 4,
        preventiveNames: ['Topiramate'],
        questionnaireScores: { hit6: 61, midas: 18 },
      },
      whatChangedKeys: ['coverage_summary'],
      questionPromptKeys: ['treatment_adjustment'],
    };
    selectResults.push([
      {
        id: 'draft-1',
        appointmentDate: new Date('2026-04-20T00:00:00.000Z'),
        visitLabel: 'Initial',
        clinicianName: 'Dr. A',
        visitReason: 'Consult',
        topConcerns: ['pain'],
        doctorQuestions: ['What now?'],
        personalNotes: 'notes',
        compareWindowDays: 90,
        generatedSnapshot: snapshot,
        createdAt: new Date('2026-04-01T12:00:00.000Z'),
        updatedAt: new Date('2026-04-02T12:00:00.000Z'),
      },
    ]);

    const { appointmentPrepService } = await import('./AppointmentPrepService');
    const draft = await appointmentPrepService.getDraft('user-1', 'draft-1');

    expect(draft).toEqual({
      id: 'draft-1',
      appointmentDate: '2026-04-20',
      visitLabel: 'Initial',
      clinicianName: 'Dr. A',
      visitReason: 'Consult',
      topConcerns: ['pain'],
      doctorQuestions: ['What now?'],
      personalNotes: 'notes',
      compareWindowDays: 90,
      generatedSnapshot: snapshot,
      createdAt: '2026-04-01T12:00:00.000Z',
      updatedAt: '2026-04-02T12:00:00.000Z',
    });
  });

  it('updates patient-authored fields without changing the stored snapshot', async () => {
    const snapshot = {
      compareWindowDays: 90,
      coverage: { totalDays: 90, recordedDays: 72, missingDays: 18 },
      attackStats: { totalAttacks: 2, avgIntensity: 5 },
      currentSnapshot: {
        headacheBurden: { migraineDays: 6, headacheDays: 10 },
        acuteMedicationDays: 4,
        preventiveNames: ['Topiramate'],
        questionnaireScores: { hit6: 61, midas: 18 },
      },
      whatChangedKeys: ['coverage_summary'],
      questionPromptKeys: ['treatment_adjustment'],
    };
    selectResults.push([
      {
        id: 'draft-1',
        appointmentDate: new Date('2026-04-20T00:00:00.000Z'),
        visitLabel: 'Initial',
        clinicianName: 'Dr. A',
        visitReason: 'Consult',
        topConcerns: ['pain'],
        doctorQuestions: ['What now?'],
        personalNotes: 'notes',
        compareWindowDays: 90,
        generatedSnapshot: snapshot,
        createdAt: new Date('2026-04-01T12:00:00.000Z'),
        updatedAt: new Date('2026-04-02T12:00:00.000Z'),
      },
    ]);
    selectResults.push([
      {
        id: 'draft-1',
        appointmentDate: new Date('2026-05-02T00:00:00.000Z'),
        visitLabel: 'Updated label',
        clinicianName: 'Dr. A',
        visitReason: 'Consult',
        topConcerns: ['pain'],
        doctorQuestions: ['What now?'],
        personalNotes: 'new notes',
        compareWindowDays: 90,
        generatedSnapshot: snapshot,
        createdAt: new Date('2026-04-01T12:00:00.000Z'),
        updatedAt: new Date('2026-04-15T12:30:00.000Z'),
      },
    ]);

    const { appointmentPrepService } = await import('./AppointmentPrepService');
    const updated = await appointmentPrepService.updateDraft('user-1', 'draft-1', {
      appointmentDate: '2026-05-02',
      visitLabel: 'Updated label',
      personalNotes: 'new notes',
    });

    expect(updateSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentDate: new Date('2026-05-02T00:00:00.000Z'),
        visitLabel: 'Updated label',
        personalNotes: 'new notes',
        updatedAt: expect.any(Date),
      }),
    );
    expect(updated.generatedSnapshot).toEqual(snapshot);
    expect(updated.appointmentDate).toBe('2026-05-02');
  });

  it('deletes an owned draft', async () => {
    selectResults.push([
      {
        id: 'draft-1',
        appointmentDate: new Date('2026-04-20T00:00:00.000Z'),
        visitLabel: 'Initial',
        clinicianName: 'Dr. A',
        visitReason: 'Consult',
        topConcerns: [],
        doctorQuestions: [],
        personalNotes: null,
        compareWindowDays: 90,
        generatedSnapshot: {
          compareWindowDays: 90,
          coverage: { totalDays: 90, recordedDays: 72, missingDays: 18 },
          attackStats: { totalAttacks: 2, avgIntensity: 5 },
          currentSnapshot: {
            headacheBurden: { migraineDays: 6, headacheDays: 10 },
            acuteMedicationDays: 4,
            preventiveNames: ['Topiramate'],
            questionnaireScores: { hit6: 61, midas: 18 },
          },
          whatChangedKeys: ['coverage_summary'],
          questionPromptKeys: ['treatment_adjustment'],
        },
        createdAt: new Date('2026-04-01T12:00:00.000Z'),
        updatedAt: new Date('2026-04-02T12:00:00.000Z'),
      },
    ]);

    const { appointmentPrepService } = await import('./AppointmentPrepService');
    await appointmentPrepService.deleteDraft('user-1', 'draft-1');

    expect(deleteWhereSpy).toHaveBeenCalled();
  });
});
