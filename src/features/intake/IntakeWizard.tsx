'use client';

import type { IntakeAnswers, IntakeBlockName, IntakeBlockPatch } from '@/models/intake';
import type { IntakeDTO } from '@/services/intake/IntakeService';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { showSnackbar } from '@/features/snackbar';
import { INTAKE_STEP_ORDER } from '@/models/intake';

import { completeIntake, fetchIntake, patchIntakeBlock, skipIntake } from './intakeApi';
import { StepFrequency } from './StepFrequency';
import { StepHabits } from './StepHabits';
import { StepMedications } from './StepMedications';
import { StepTriggers } from './StepTriggers';

function buildIntakeBlockPatch<K extends IntakeBlockName>(
  block: K,
  value: IntakeAnswers[K],
): Extract<IntakeBlockPatch, { block: K }> {
  return { block, value } as Extract<IntakeBlockPatch, { block: K }>;
}

export function IntakeWizard() {
  const t = useTranslations('Intake');
  const router = useRouter();
  const [dto, setDto] = useState<IntakeDTO | null>(null);
  const [draft, setDraft] = useState<IntakeAnswers | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchIntake()
      .then((loaded) => {
        setDto(loaded);
        setDraft(loaded.answers);
        setStep(Math.min(loaded.currentStep, INTAKE_STEP_ORDER.length - 1));
      })
      .catch(() => router.push('/dashboard'));
    // Intentionally run once on mount: `router` isn't stable across renders
    // in all environments (e.g. test mocks), and re-running this effect would
    // refetch and clobber in-progress answers with the last-loaded state.
    // eslint-disable-next-line react/exhaustive-deps
  }, []);

  if (!dto || !draft) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const block = INTAKE_STEP_ORDER[step]!;
  const isLast = step === INTAKE_STEP_ORDER.length - 1;

  const advance = async () => {
    setBusy(true);
    try {
      await patchIntakeBlock(buildIntakeBlockPatch(block, draft[block]));
      if (isLast) {
        await completeIntake();
        router.replace('/dashboard');
      } else {
        setStep(step + 1);
      }
    } catch {
      showSnackbar({ message: t('save_failed') });
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      await skipIntake();
      router.replace('/dashboard');
    } catch {
      showSnackbar({ message: t('save_failed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-28 pt-8">
      <div className="flex-1">
        {block === 'frequency' && (
          <StepFrequency
            value={draft.frequency?.band ?? null}
            onChange={band => setDraft({ ...draft, frequency: { band } })}
          />
        )}
        {block === 'triggers' && (
          <StepTriggers
            keys={draft.triggers?.keys ?? []}
            custom={draft.triggers?.custom ?? []}
            onChange={next => setDraft({ ...draft, triggers: next })}
          />
        )}
        {block === 'medications' && (
          <StepMedications
            acute={draft.medications?.acute ?? []}
            preventive={draft.medications?.preventive ?? []}
            onChange={next => setDraft({ ...draft, medications: next })}
          />
        )}
        {block === 'habits' && (
          <StepHabits
            value={draft.habits ?? { sleepTrouble: null, typicalBed: null, typicalWake: null, medTiming: null }}
            onChange={next => setDraft({ ...draft, habits: next })}
          />
        )}
      </div>
      <div className="safe-bottom fixed inset-x-0 bottom-0 mx-auto flex max-w-md gap-3 bg-background px-4 pt-4">
        <button type="button" onClick={skip} disabled={busy} className="min-h-[44px] flex-1 rounded-lg border px-4">
          {t('skip')}
        </button>
        <button
          type="button"
          onClick={advance}
          disabled={busy}
          className="min-h-[44px] flex-1 rounded-lg bg-primary px-4 text-primary-foreground"
        >
          {isLast ? t('finish') : t('next')}
        </button>
      </div>
    </div>
  );
}
