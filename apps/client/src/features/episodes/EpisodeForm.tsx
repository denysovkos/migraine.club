'use client';

import type { EpisodeProtectorFactorKey, EpisodeTriggerFactorKey } from './episodeFactorMappings';
import type { CreateEpisodeInput, Episode, SymptomType } from '@/types/Episode';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { PainLevelPicker } from '@/components/PainLevelPicker';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { logFactorEvent } from '@/features/factors/factorsApi';
import { fetchIntake } from '@/features/intake/intakeApi';
import { upsertDoseOutcome } from '@/features/quickAdd/acuteMedsApi';
import { EditMedicationIntakeSheet } from '@/features/quickAdd/EditMedicationIntakeSheet';
import { quickAddUndoIntake } from '@/features/quickAdd/quickAddApi';
import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';
import { showSnackbar } from '@/features/snackbar';
import { sendOrQueue } from '@/libs/offline/outbox';
import { getBuiltInFactorsByType } from '@/services/factors/factorCatalog';
import { sortTriggersByIntake } from '@/services/intake/intakeTriggerPriority';
import {
  CreateEpisodeSchema,
  PainLocation,
  PainType,
  Symptom,
} from '@/types/Episode';

import { normalizeToPainLevel } from '@/utils/painLevel';
import {
  PROTECTOR_KEY_TO_VALUE,
  PROTECTOR_VALUE_TO_KEY,
  TRIGGER_KEY_TO_VALUE,
  TRIGGER_VALUE_TO_KEY,
} from './episodeFactorMappings';

/**
 * Convert a Date to local datetime-local input format (YYYY-MM-DDTHH:mm)
 * Uses local timezone methods to display in user's timezone
 */
function toLocalDateTimeString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

type EpisodeFormProps = {
  episode?: Episode;
  onSuccess?: () => void;
  onRefreshEpisode?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
};

function toLocalDate(isoLike?: string): string | undefined {
  const date = isoLike ? new Date(isoLike) : new Date();
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function EpisodeForm({ episode, onSuccess, onRefreshEpisode, onDelete, isDeleting }: EpisodeFormProps) {
  const t = useTranslations('EpisodeForm');
  const tDetail = useTranslations('EpisodeDetail');
  const tEpisodes = useTranslations('Episodes');
  const tOffline = useTranslations('OfflineSync');
  const tFactors = useTranslations('Factors' as never) as (key: string) => string;
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [takeOpen, setTakeOpen] = useState(false);
  const [editIntakeOpen, setEditIntakeOpen] = useState(false);
  const [savingDoseOutcomeId, setSavingDoseOutcomeId] = useState<string | null>(null);
  const [editIntakeState, setEditIntakeState] = useState<{
    intakeId: string | null;
    label: string;
    dose: string | null;
    unit: string | null;
    unitIsCustom: boolean;
  } | null>(null);

  const isEditing = !!episode;
  const [intakeTriggerKeys, setIntakeTriggerKeys] = useState<string[]>([]);
  useEffect(() => {
    let mounted = true;
    fetchIntake()
      .then((dto) => {
        if (mounted) {
          setIntakeTriggerKeys(dto.answers.triggers?.keys ?? []);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  const triggerOptions = useMemo(
    () => sortTriggersByIntake(getBuiltInFactorsByType('trigger'), intakeTriggerKeys),
    [intakeTriggerKeys],
  );
  const protectorOptions = useMemo(() => getBuiltInFactorsByType('protector'), []);
  const initialSelectedTriggerKeys = useMemo(
    () => (episode?.triggers ?? []).map(trigger => TRIGGER_VALUE_TO_KEY[trigger]).filter(Boolean) as EpisodeTriggerFactorKey[],
    [episode?.triggers],
  );
  const initialSelectedProtectorKeys = useMemo(
    () => (episode?.protectors ?? []).map(protector => PROTECTOR_VALUE_TO_KEY[protector]).filter(Boolean) as EpisodeProtectorFactorKey[],
    [episode?.protectors],
  );
  const [selectedTriggerKeys, setSelectedTriggerKeys] = useState<EpisodeTriggerFactorKey[]>(initialSelectedTriggerKeys);
  const [selectedProtectorKeys, setSelectedProtectorKeys] = useState<EpisodeProtectorFactorKey[]>(initialSelectedProtectorKeys);

  const form = useForm<CreateEpisodeInput, any, CreateEpisodeInput>({
    resolver: zodResolver(CreateEpisodeSchema) as any,
    defaultValues: episode
      ? {
          attackType: episode.attackType ?? 'migraine',
          startTime: new Date(episode.startTime).toISOString(),
          onsetAt: (episode as any).onsetAt ? new Date((episode as any).onsetAt).toISOString() : undefined,
          // Only set endTime when it exists; avoid defaulting to now for ongoing episodes
          endTime: episode.endTime ? new Date(episode.endTime).toISOString() : undefined,
          isOngoing: episode.isOngoing,
          intensity: normalizeToPainLevel(episode.intensity) ?? 3,
          painLocation: episode.painLocation,
          painLocationOther: episode.painLocationOther ?? undefined,
          painType: episode.painType,
          painTypeOther: episode.painTypeOther ?? undefined,
          symptoms: episode.symptoms,
          symptomsOther: episode.symptomsOther ?? undefined,
          triggers: episode.triggers,
          protectors: episode.protectors,
          triggersOther: episode.triggersOther ?? undefined,
          notes: episode.notes ?? undefined,
        }
      : {
          attackType: 'migraine',
          startTime: new Date().toISOString(),
          intensity: 3,
          painLocation: PainLocation.WHOLE_HEAD,
          painType: PainType.THROBBING,
          symptoms: [],
          triggers: [],
          protectors: [],
          isOngoing: false,
        },
  });

  const isOngoing = form.watch('isOngoing');
  const painLocation = form.watch('painLocation');
  const painType = form.watch('painType');
  const symptoms = form.watch('symptoms');
  const hasOtherTriggerSelected = selectedTriggerKeys.includes('other');

  const onSubmit = async (data: CreateEpisodeInput) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const cleanData: CreateEpisodeInput = {
        ...data,
        triggers: selectedTriggerKeys.map(key => TRIGGER_KEY_TO_VALUE[key]),
        protectors: selectedProtectorKeys.map(key => PROTECTOR_KEY_TO_VALUE[key]),
      } as CreateEpisodeInput;

      // When editing, avoid sending endTime if episode is marked ongoing to prevent server-side 400
      if (isEditing && cleanData.isOngoing) {
        // remove endTime from payload entirely
        delete (cleanData as any).endTime;
      }

      const url = isEditing
        ? `/api/episodes/${episode.id}`
        : '/api/episodes';
      const method: 'PATCH' | 'POST' = isEditing ? 'PATCH' : 'POST';

      // Queued on the device when offline; the form already carries explicit
      // start/end times, so a late sync stores exactly what was entered.
      const result = await sendOrQueue({
        url,
        method,
        body: cleanData,
        kind: isEditing ? 'attack_update' : 'attack',
      });

      if (result.queued) {
        showSnackbar({ message: tOffline('saved_offline') });
      } else if (!result.response.ok) {
        const errorData = await result.response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save episode');
      }

      const localDate = toLocalDate(cleanData.startTime);
      const newTriggerKeys = selectedTriggerKeys.filter(key => !initialSelectedTriggerKeys.includes(key));
      const newProtectorKeys = selectedProtectorKeys.filter(key => !initialSelectedProtectorKeys.includes(key));
      const factorWrites = [
        ...newTriggerKeys.map(key =>
          logFactorEvent({ displayName: key, type: 'trigger', localDate })),
        ...newProtectorKeys.map(key =>
          logFactorEvent({ displayName: key, type: 'protector', localDate })),
      ];

      if (factorWrites.length > 0) {
        const factorResults = await Promise.allSettled(factorWrites);
        if (factorResults.some(result => result.status === 'rejected')) {
          showSnackbar({ message: tFactors('save_error') });
        }
      }

      if (onSuccess) {
        onSuccess();
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSymptom = (symptom: SymptomType) => {
    const current = symptoms || [];
    const updated = current.includes(symptom)
      ? current.filter(s => s !== symptom)
      : [...current, symptom];
    form.setValue('symptoms', updated as SymptomType[]);
  };

  const toggleFactorKey = <TKey extends string>(
    selectedKeys: TKey[],
    setSelectedKeys: (value: TKey[]) => void,
    key: TKey,
  ) => {
    const updated = selectedKeys.includes(key)
      ? selectedKeys.filter(item => item !== key)
      : [...selectedKeys, key];
    setSelectedKeys(updated);
  };

  async function saveDoseOutcome(args: {
    doseId: string;
    helped: 'yes' | 'partly' | 'no';
    backToNormalFunction?: boolean | null;
    timeToReliefMinutes?: number | null;
  }) {
    try {
      setSavingDoseOutcomeId(args.doseId);
      await upsertDoseOutcome(args);
      onRefreshEpisode?.();
      showSnackbar({ message: t('acute_outcome_saved') });
    } catch (e: any) {
      showSnackbar({ message: e?.message || t('acute_outcome_save_failed') });
    } finally {
      setSavingDoseOutcomeId(null);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="attackType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tEpisodes('type_label')}</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    disabled={isSubmitting}
                  >
                    <option value="migraine">{tEpisodes('type_migraine')}</option>
                    <option value="headache">{tEpisodes('type_headache')}</option>
                  </select>
                </FormControl>
                <FormDescription>{tEpisodes('type_description')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="startTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('start_time_label')}</FormLabel>
                <FormControl>
                  <Input
                    type="datetime-local"
                    {...field}
                    value={
                      field.value
                        ? toLocalDateTimeString(new Date(field.value))
                        : ''
                    }
                    onChange={(e) => {
                      const value = e.target.value
                        ? new Date(e.target.value).toISOString()
                        : undefined;
                      field.onChange(value);
                    }}
                  />
                </FormControl>
                <FormDescription>{t('start_time_description')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="onsetAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('onset_at_label')}</FormLabel>
                <FormControl>
                  <Input
                    type="datetime-local"
                    {...field}
                    value={
                      field.value
                        ? toLocalDateTimeString(new Date(field.value))
                        : ''
                    }
                    onChange={(e) => {
                      const value = e.target.value
                        ? new Date(e.target.value).toISOString()
                        : undefined;
                      field.onChange(value);
                    }}
                  />
                </FormControl>
                <FormDescription>{t('onset_at_description')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isOngoing"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={field.onChange}
                    className="size-4 rounded border-gray-300"
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>{t('is_ongoing_label')}</FormLabel>
                  <FormDescription>{t('is_ongoing_description')}</FormDescription>
                </div>
              </FormItem>
            )}
          />

          {!isOngoing && (
            <FormField
              control={form.control}
              name="endTime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('end_time_label')}</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      {...field}
                      value={
                        field.value
                          ? toLocalDateTimeString(new Date(field.value))
                          : ''
                      }
                      onChange={(e) => {
                        const value = e.target.value
                          ? new Date(e.target.value).toISOString()
                          : undefined;
                        field.onChange(value);
                      }}
                    />
                  </FormControl>
                  <FormDescription>{t('end_time_description')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <FormField
          control={form.control}
          name="intensity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t('intensity_label')}
              </FormLabel>
              <FormControl>
                <PainLevelPicker
                  value={normalizeToPainLevel(field.value)}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormDescription>{t('intensity_description')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="painLocation"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('pain_location_label')}</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  >
                    {Object.values(PainLocation).map(location => (
                      <option key={location} value={location}>
                        {t(`pain_location_${location.toLowerCase()}` as any)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {painLocation === PainLocation.OTHER && (
            <FormField
              control={form.control}
              name="painLocationOther"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('pain_location_other_label')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('pain_location_other_placeholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="painType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('pain_type_label')}</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  >
                    {Object.values(PainType).map(type => (
                      <option key={type} value={type}>
                        {t(`pain_type_${type.toLowerCase()}` as any)}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {painType === PainType.OTHER && (
            <FormField
              control={form.control}
              name="painTypeOther"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('pain_type_other_label')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('pain_type_other_placeholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div>
          <Label>{t('symptoms_label')}</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            {Object.values(Symptom).map(symptom => (
              <label key={symptom} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={symptoms?.includes(symptom)}
                  onChange={() => toggleSymptom(symptom)}
                  className="size-4 rounded border-gray-300"
                />
                <span className="text-sm">
                  {t(`symptom_${symptom.toLowerCase()}` as any)}
                </span>
              </label>
            ))}
          </div>
          {symptoms?.includes(Symptom.OTHER) && (
            <FormField
              control={form.control}
              name="symptomsOther"
              render={({ field }) => (
                <FormItem className="mt-2">
                  <FormControl>
                    <Input {...field} placeholder={t('symptoms_other_placeholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {!episode?.isOngoing && (episode?.attackTreatment?.doses?.length ?? 0) > 0 && (
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <div className="text-sm font-semibold">{t('acute_end_section_title')}</div>
            <div className="text-xs text-muted-foreground">{t('acute_end_section_description')}</div>
            {episode!.attackTreatment!.doses.map(dose => (
              <div key={dose.doseId} className="rounded-md border bg-background p-2">
                <div className="mb-2 text-sm font-medium">{dose.medicationLabel}</div>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant={dose.outcome?.helped === 'yes' ? 'default' : 'outline'}
                    className="h-10"
                    disabled={savingDoseOutcomeId === dose.doseId}
                    onClick={() => saveDoseOutcome({ doseId: dose.doseId, helped: 'yes' })}
                  >
                    {t('acute_helped_yes')}
                  </Button>
                  <Button
                    type="button"
                    variant={dose.outcome?.helped === 'partly' ? 'default' : 'outline'}
                    className="h-10"
                    disabled={savingDoseOutcomeId === dose.doseId}
                    onClick={() => saveDoseOutcome({ doseId: dose.doseId, helped: 'partly' })}
                  >
                    {t('acute_helped_partly')}
                  </Button>
                  <Button
                    type="button"
                    variant={dose.outcome?.helped === 'no' ? 'default' : 'outline'}
                    className="h-10"
                    disabled={savingDoseOutcomeId === dose.doseId}
                    onClick={() => saveDoseOutcome({ doseId: dose.doseId, helped: 'no' })}
                  >
                    {t('acute_helped_no')}
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={savingDoseOutcomeId === dose.doseId}
                    onClick={() => saveDoseOutcome({
                      doseId: dose.doseId,
                      helped: dose.outcome?.helped ?? 'partly',
                      backToNormalFunction: true,
                    })}
                  >
                    {t('acute_back_to_function')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={savingDoseOutcomeId === dose.doseId}
                    onClick={() => saveDoseOutcome({
                      doseId: dose.doseId,
                      helped: dose.outcome?.helped ?? 'partly',
                      timeToReliefMinutes: 60,
                    })}
                  >
                    {t('acute_time_to_relief')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <Label>{tFactors('trigger_title')}</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {triggerOptions.map((trigger) => {
              const triggerKey = trigger.key as EpisodeTriggerFactorKey;
              const isSelected = selectedTriggerKeys.includes(triggerKey);
              return (
                <Button
                  key={trigger.key}
                  type="button"
                  variant={isSelected ? 'default' : 'outline'}
                  aria-pressed={isSelected}
                  disabled={isSubmitting}
                  onClick={() => toggleFactorKey(selectedTriggerKeys, setSelectedTriggerKeys, triggerKey)}
                >
                  {tFactors(trigger.translationKey)}
                </Button>
              );
            })}
          </div>
          {hasOtherTriggerSelected && (
            <FormField
              control={form.control}
              name="triggersOther"
              render={({ field }) => (
                <FormItem className="mt-2">
                  <FormControl>
                    <Input {...field} placeholder={t('triggers_other_placeholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div>
          <Label>{tFactors('protector_title')}</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {protectorOptions.map((protector) => {
              const protectorKey = protector.key as EpisodeProtectorFactorKey;
              const isSelected = selectedProtectorKeys.includes(protectorKey);
              return (
                <Button
                  key={protector.key}
                  type="button"
                  variant={isSelected ? 'default' : 'outline'}
                  aria-pressed={isSelected}
                  disabled={isSubmitting}
                  onClick={() => toggleFactorKey(selectedProtectorKeys, setSelectedProtectorKeys, protectorKey)}
                >
                  {tFactors(protector.translationKey)}
                </Button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>{t('medication_intakes_label')}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('medication_intakes_description')}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setTakeOpen(true)}
              disabled={!episode}
            >
              {t('medication_intakes_add')}
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            {(episode?.medicationIntakes ?? []).length === 0 && (
              <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
                {t('medication_intakes_empty')}
              </div>
            )}

            {(episode?.medicationIntakes ?? []).map((mi) => {
              const time = new Date(mi.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const suffix = [mi.dose, mi.unit].filter(Boolean).join(' ');
              return (
                <div key={mi.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{mi.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {time}
                      {suffix ? ` • ${suffix}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      onClick={() => {
                        setEditIntakeState({
                          intakeId: mi.id,
                          label: mi.label,
                          dose: mi.dose ?? null,
                          unit: mi.unit ?? null,
                          unitIsCustom: mi.unitIsCustom,
                        });
                        setEditIntakeOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      onClick={async () => {
                        try {
                          await quickAddUndoIntake(mi.id);
                          onRefreshEpisode?.();
                        } catch (e: any) {
                          showSnackbar({ message: e?.message || 'Failed to remove intake' });
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('notes_label')}</FormLabel>
              <FormControl>
                <textarea
                  {...field}
                  rows={4}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  placeholder={t('notes_placeholder')}
                />
              </FormControl>
              <FormDescription>{t('notes_description')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={isSubmitting} className="min-h-11">
            {isSubmitting
              ? t('saving')
              : isEditing
                ? t('update_button')
                : t('save_button')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => router.back()}
          >
            {t('cancel_button')}
          </Button>
          {isEditing && onDelete && (
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              onClick={onDelete}
              disabled={!!isDeleting || isSubmitting}
            >
              {isDeleting ? tDetail('deleting') : tDetail('delete_button')}
            </Button>
          )}
        </div>
      </form>
      <TakeMedicationSheet
        open={takeOpen}
        onOpenChange={setTakeOpen}
        episodeId={episode?.id ?? null}
        onDidLog={() => {
          onRefreshEpisode?.();
        }}
      />

      <EditMedicationIntakeSheet
        open={editIntakeOpen}
        onOpenChange={setEditIntakeOpen}
        intakeId={editIntakeState?.intakeId ?? null}
        label={editIntakeState?.label ?? 'Medication'}
        initialDose={editIntakeState?.dose ?? null}
        initialUnit={editIntakeState?.unit ?? null}
        initialUnitIsCustom={editIntakeState?.unitIsCustom ?? false}
        onSaved={() => onRefreshEpisode?.()}
      />
    </Form>
  );
}
