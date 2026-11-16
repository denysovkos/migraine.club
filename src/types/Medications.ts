import { z } from 'zod';

export const DoseUnit = {
  MG: 'mg',
  G: 'g',
  MCG: 'mcg',
  ML: 'ml',
  IU: 'IU',
  TABLET: 'tablet(s)',
  CAPSULE: 'capsule(s)',
  SPRAY: 'spray(s)',
  PUFF: 'puff(s)',
  DROP: 'drop(s)',
  PATCH: 'patch(es)',
  INJECTION: 'injection(s)',
  SUPPOSITORY: 'suppository(ies)',
  SACHET: 'sachet(s)',
} as const;

export const DoseUnitOptions = Object.values(DoseUnit);
export type DoseUnitType = (typeof DoseUnitOptions)[number];

export const MedicationCatalogEntrySchema = z.object({
  id: z.string().guid(),
  canonicalName: z.string(),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
});
export type MedicationCatalogEntry = z.infer<typeof MedicationCatalogEntrySchema>;

export const UserMedicationSchema = z.object({
  id: z.string().guid(),
  userId: z.string(),
  catalogMedicationId: z.string().guid().nullable(),
  customName: z.string().nullable(),
  defaultDose: z.string().nullable(),
  defaultUnit: z.string().nullable(),
  defaultUnitIsCustom: z.boolean(),
  lastUsedDose: z.string().nullable().optional(),
  lastUsedUnit: z.string().nullable().optional(),
  lastUsedUnitIsCustom: z.boolean().optional(),
  lastUsedAt: z.string().datetime().nullable().optional(),
  isPinned: z.boolean(),
});
export type UserMedication = z.infer<typeof UserMedicationSchema>;

export const QuickAddSuggestionSchema = z.object({
  userMedicationId: z.string().guid(),
  label: z.string(),
  suggestedDose: z.string().nullable(),
  suggestedUnit: z.string().nullable(),
  unitIsCustom: z.boolean(),
  lastUsedAt: z.string().datetime(),
  score: z.number(),
});
export type QuickAddSuggestion = z.infer<typeof QuickAddSuggestionSchema>;

export const QuickAddSuggestionsResponseSchema = z.object({
  topMeds: z.array(QuickAddSuggestionSchema),
  hasOngoingEpisode: z.boolean(),
});
export type QuickAddSuggestionsResponse = z.infer<
  typeof QuickAddSuggestionsResponseSchema
>;

export const CreateQuickMedicationIntakeSchema = z
  .object({
    // Preferred: log intake for an existing user medication.
    userMedicationId: z.string().guid().optional(),
    // Convenience for 1-tap search results: if userMedicationId not provided,
    // server can upsert a user_medication row from a catalog entry.
    catalogMedicationId: z.string().guid().optional(),
    // Convenience for custom free-text meds: server can upsert a user_medication row.
    customName: z.string().trim().min(1).max(200).optional(),
    dose: z.string().trim().min(1).max(100).optional(),
    unit: z.string().trim().min(1).max(50).optional(),
    unitIsCustom: z.boolean().optional(),
    // Optional explicit episode linkage (used by Episode Edit screen).
    // If not provided, server will auto-link to ongoing episode when available.
    episodeId: z.number().int().positive().optional(),
    // When the dose was taken, as captured on the device. Doses queued offline
    // are synced later and must keep this time. Defaults to server time.
    takenAt: z.string().datetime().optional(),
    // Also record the dose in the acute-dose ledger (MOH counting, outcomes)
    // in the same request, so one offline queue entry covers the whole log.
    recordAcuteDose: z.boolean().optional(),
  })
  .refine(
    d => !!d.userMedicationId || !!d.catalogMedicationId || !!d.customName,
    { message: 'userMedicationId, catalogMedicationId, or customName is required' },
  );

export type CreateQuickMedicationIntakeInput = z.infer<
  typeof CreateQuickMedicationIntakeSchema
>;

export const CreateQuickMedicationIntakeResponseSchema = z.object({
  intakeId: z.string().guid(),
  linkedEpisodeId: z.number().int().optional(),
  userMedicationId: z.string().guid(),
  acuteDoseId: z.string().guid().optional(),
});
export type CreateQuickMedicationIntakeResponse = z.infer<
  typeof CreateQuickMedicationIntakeResponseSchema
>;

export const UpdateMedicationIntakeSchema = z.object({
  dose: z.string().trim().min(1).max(100).nullable().optional(),
  unit: z.string().trim().min(1).max(50).nullable().optional(),
  unitIsCustom: z.boolean().optional(),
  takenAt: z.string().datetime().nullable().optional(),
});
export type UpdateMedicationIntakeInput = z.infer<typeof UpdateMedicationIntakeSchema>;

export const MedicationPickerItemSchema = z.object({
  id: z.string().guid(),
  label: z.string(),
  defaultDose: z.string().nullable(),
  defaultUnit: z.string().nullable(),
  defaultUnitIsCustom: z.boolean(),
  lastUsedDose: z.string().nullable(),
  lastUsedUnit: z.string().nullable(),
  lastUsedUnitIsCustom: z.boolean(),
  lastUsedAt: z.string().datetime().nullable(),
  isPinned: z.boolean(),
});
export type MedicationPickerItem = z.infer<typeof MedicationPickerItemSchema>;

export const MedicationPickerIndexResponseSchema = z.object({
  pinned: z.array(MedicationPickerItemSchema),
  recentlyUsed: z.array(MedicationPickerItemSchema),
  all: z.array(MedicationPickerItemSchema),
});
export type MedicationPickerIndexResponse = z.infer<typeof MedicationPickerIndexResponseSchema>;

export const MedicationSearchResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    userMedicationId: z.string().guid(),
    catalogMedicationId: z.string().guid().nullable(),
    label: z.string(),
    defaultDose: z.string().nullable(),
    defaultUnit: z.string().nullable(),
    defaultUnitIsCustom: z.boolean(),
    lastUsedDose: z.string().nullable(),
    lastUsedUnit: z.string().nullable(),
    lastUsedUnitIsCustom: z.boolean(),
    isPinned: z.boolean(),
  }),
  z.object({
    kind: z.literal('catalog'),
    catalogMedicationId: z.string().guid(),
    label: z.string(),
  }),
]);
export type MedicationSearchResult = z.infer<typeof MedicationSearchResultSchema>;

export const MedicationSearchResponseSchema = z.object({
  results: z.array(MedicationSearchResultSchema),
});
export type MedicationSearchResponse = z.infer<typeof MedicationSearchResponseSchema>;
