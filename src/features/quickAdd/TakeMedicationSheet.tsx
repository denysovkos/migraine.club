'use client';

import type { MedicationPickerMyMedication } from '@/components/medications/MedicationPickerSheet';

import type { CreateQuickMedicationIntakeInput } from '@/types/Medications';
import { useEffect, useMemo, useRef, useState } from 'react';
import {

  MedicationPickerSheet,
} from '@/components/medications/MedicationPickerSheet';
import { createAcuteDose } from '@/features/quickAdd/acuteMedsApi';
import { EditMedicationIntakeSheet } from '@/features/quickAdd/EditMedicationIntakeSheet';
import {
  fetchMedicationPickerIndex,
  fetchQuickAddSuggestions,
  quickAddCreateIntake,
  quickAddUndoIntake,
  searchMedications,
} from '@/features/quickAdd/quickAddApi';
import { showSnackbar } from '@/features/snackbar';

export type TakeMedicationSelection = {
  label: string;
  payload: CreateQuickMedicationIntakeInput;
  suggestedDose: string | null;
  suggestedUnit: string | null;
  unitIsCustom: boolean;
};

function toPickerMedication(row: any): MedicationPickerMyMedication {
  return {
    id: row.id,
    label: row.label,
    defaultDose: row.defaultDose ?? null,
    defaultUnit: row.defaultUnit ?? null,
    defaultUnitIsCustom: Boolean(row.defaultUnitIsCustom),
    lastUsedDose: row.lastUsedDose ?? null,
    lastUsedUnit: row.lastUsedUnit ?? null,
    lastUsedUnitIsCustom: Boolean(row.lastUsedUnitIsCustom),
    isPinned: Boolean(row.isPinned),
  };
}

export function TakeMedicationSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSelection?: TakeMedicationSelection | null;
  episodeId?: number | null;
  onDidLog?: () => void;
}) {
  const [pinnedMeds, setPinnedMeds] = useState<MedicationPickerMyMedication[]>([]);
  const [recentMeds, setRecentMeds] = useState<MedicationPickerMyMedication[]>([]);
  const [myMeds, setMyMeds] = useState<MedicationPickerMyMedication[]>([]);
  const [hasOngoingEpisode, setHasOngoingEpisode] = useState(false);
  const [loading, setLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editState, setEditState] = useState<{
    intakeId: string | null;
    label: string;
    dose: string | null;
    unit: string | null;
    unitIsCustom: boolean;
    takenAt: Date;
  } | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  async function loadPickerData() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const [indexData, suggestionsData] = await Promise.all([
        fetchMedicationPickerIndex({ signal: controller.signal }),
        fetchQuickAddSuggestions({ signal: controller.signal }),
      ]);
      setPinnedMeds(indexData.pinned.map(toPickerMedication));
      setRecentMeds(indexData.recentlyUsed.map(toPickerMedication));
      setMyMeds(indexData.all.map(toPickerMedication));
      setHasOngoingEpisode(suggestionsData.hasOngoingEpisode);
    } catch {
      setPinnedMeds([]);
      setRecentMeds([]);
      setMyMeds([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!props.open) {
      return;
    }
    loadPickerData();
    return () => controllerRef.current?.abort();
  }, [props.open]);

  const initialPickerSelection = useMemo(() => {
    const fromProps = props.initialSelection;
    if (!fromProps) {
      return null;
    }
    if (fromProps.payload.userMedicationId) {
      return {
        kind: 'my' as const,
        medicationId: fromProps.payload.userMedicationId,
        dose: fromProps.suggestedDose,
        unit: fromProps.suggestedUnit,
        unitIsCustom: fromProps.unitIsCustom,
      };
    }
    if (fromProps.payload.catalogMedicationId) {
      return {
        kind: 'catalog' as const,
        medicationId: fromProps.payload.catalogMedicationId,
        dose: fromProps.suggestedDose,
        unit: fromProps.suggestedUnit,
        unitIsCustom: fromProps.unitIsCustom,
      };
    }
    return null;
  }, [props.initialSelection]);

  async function handleLog(args: {
    medication:
      | { kind: 'my'; medication: MedicationPickerMyMedication }
      | { kind: 'catalog'; medication: { id: string; label: string } };
    dose: string | null;
    unit: string | null;
    unitIsCustom: boolean;
  }) {
    const payload: CreateQuickMedicationIntakeInput = {
      ...(args.medication.kind === 'my'
        ? { userMedicationId: args.medication.medication.id }
        : { catalogMedicationId: args.medication.medication.id }),
      ...(props.episodeId ? { episodeId: props.episodeId } : {}),
      ...(args.dose ? { dose: args.dose } : {}),
      ...(args.unit ? { unit: args.unit } : {}),
      ...(args.unitIsCustom ? { unitIsCustom: true } : {}),
    };

    let intakeId: string | null = null;
    let undone = false;
    const abort = new AbortController();
    const loggedAt = new Date();

    const label = args.medication.medication.label;

    const commit = quickAddCreateIntake(payload, { signal: abort.signal })
      .then(async (result) => {
        intakeId = result.intakeId;
        await createAcuteDose({
          medicationId: result.userMedicationId,
          attackId: props.episodeId ?? result.linkedEpisodeId ?? null,
          dose: args.dose,
          unit: args.unit,
          unitIsCustom: args.unitIsCustom,
        }).catch(() => {});
        if (undone && intakeId) {
          await quickAddUndoIntake(intakeId).catch(() => {});
        }
      })
      .catch((error: any) => {
        showSnackbar({ message: error?.message || 'Failed to log medication' });
      })
      .finally(() => {
        props.onDidLog?.();
        loadPickerData();
      });

    props.onOpenChange(false);
    showSnackbar({
      message: `${label} logged`,
      actions: [
        {
          label: 'Undo',
          onClick: async () => {
            undone = true;
            abort.abort();
            if (intakeId) {
              await quickAddUndoIntake(intakeId);
              props.onDidLog?.();
              loadPickerData();
            } else {
              await commit;
            }
          },
        },
        {
          label: 'Edit',
          onClick: async () => {
            if (!intakeId) {
              await commit;
            }
            if (!intakeId) {
              return;
            }
            setEditState({
              intakeId,
              label,
              dose: args.dose,
              unit: args.unit,
              unitIsCustom: args.unitIsCustom,
              takenAt: loggedAt,
            });
            setEditOpen(true);
          },
        },
      ],
    });
  }

  return (
    <>
      <MedicationPickerSheet
        open={props.open}
        onOpenChange={props.onOpenChange}
        pinnedMeds={pinnedMeds}
        recentMeds={recentMeds}
        myMeds={myMeds}
        hasOngoingEpisode={hasOngoingEpisode}
        initialSelection={initialPickerSelection}
        catalogSearchFn={async (query, signal) => {
          const response = await searchMedications(query, { signal });
          return response.results
            .filter(result => result.kind === 'catalog')
            .map(item => ({ id: item.catalogMedicationId, label: item.label }));
        }}
        onLogDose={handleLog}
      />

      <EditMedicationIntakeSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        intakeId={editState?.intakeId ?? null}
        label={editState?.label ?? 'Medication'}
        initialDose={editState?.dose ?? null}
        initialUnit={editState?.unit ?? null}
        initialUnitIsCustom={editState?.unitIsCustom ?? false}
        initialTakenAt={editState?.takenAt ?? null}
        onSaved={() => {
          props.onDidLog?.();
          loadPickerData();
        }}
      />

      {loading && props.open && (
        <div className="sr-only" aria-live="polite">
          Loading medications
        </div>
      )}
    </>
  );
}
