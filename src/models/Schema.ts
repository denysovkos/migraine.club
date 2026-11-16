import type { AppointmentPrepSnapshot } from '@/models/appointmentPrep';

import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// User roles for moderation
export const UserRole = {
  USER: 'user',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  // Doctor account lifecycle (Feature F13)
  DOCTOR_PENDING: 'doctor_pending',
  DOCTOR_VERIFIED: 'doctor_verified',
  DOCTOR_REJECTED: 'doctor_rejected',
} as const;

export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];

// Doctor verification application lifecycle (Feature F13)
export const DoctorVerificationApplicationStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REVOKED: 'revoked',
} as const;

export type DoctorVerificationApplicationStatusType
  = (typeof DoctorVerificationApplicationStatus)[keyof typeof DoctorVerificationApplicationStatus];

export const DoctorVerificationSpecialty = {
  NEUROLOGIST: 'neurologist',
  GP: 'gp',
  PAIN_SPECIALIST: 'pain_specialist',
  OTHER: 'other',
} as const;

export type DoctorVerificationSpecialtyType
  = (typeof DoctorVerificationSpecialty)[keyof typeof DoctorVerificationSpecialty];

export const DoctorVerificationMethod = {
  LICENSE_NUMBER: 'license_number',
  CLINIC_EMAIL: 'clinic_email',
  DOCUMENT_UPLOAD: 'document_upload',
} as const;

export type DoctorVerificationMethodType
  = (typeof DoctorVerificationMethod)[keyof typeof DoctorVerificationMethod];

export const FeatureRequestResolution = {
  SENT: 'SENT',
  IN_REVIEW: 'IN REVIEW',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
} as const;

export type FeatureRequestResolutionType
  = (typeof FeatureRequestResolution)[keyof typeof FeatureRequestResolution];

// Supported languages for user preference
export const SupportedLanguages = ['en', 'fr', 'uk'] as const;
export type SupportedLanguageType = (typeof SupportedLanguages)[number];

export const ThemePreferences = ['light', 'dark'] as const;
export type ThemePreferenceType = (typeof ThemePreferences)[number];

export const userSchema = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionPriceId: text('stripe_subscription_price_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    stripeSubscriptionCurrentPeriodEnd: bigint(
      'stripe_subscription_current_period_end',
      { mode: 'number' },
    ),
    // User profile fields
    displayName: text('display_name').notNull().default(''),
    preferredLanguage: text('preferred_language').$type<SupportedLanguageType>().notNull().default('en'),
    themePreference: text('theme_preference').$type<ThemePreferenceType>().notNull().default('light'),
    // Community profile fields (deprecated, use displayName instead)
    communityHandle: text('community_handle'),
    isDoctor: boolean('is_doctor').notNull().default(false),
    isDoctorVerified: boolean('is_doctor_verified').notNull().default(false),
    // User role for moderation (user | moderator | admin)
    role: text('role').$type<UserRoleType>().notNull().default('user'),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      stripeCustomerIdIdx: uniqueIndex('stripe_customer_id_idx').on(
        table.stripeCustomerId,
      ),
      communityHandleIdx: uniqueIndex('user_community_handle_idx').on(
        table.communityHandle,
      ),
    };
  },
);

// Doctor verification applications (Feature F13)
export const doctorVerificationApplicationSchema = pgTable(
  'doctor_verification_application',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    status: text('status')
      .$type<DoctorVerificationApplicationStatusType>()
      .notNull()
      .default(DoctorVerificationApplicationStatus.PENDING),
    fullName: text('full_name').notNull(),
    country: text('country').notNull(),
    specialty: text('specialty').$type<DoctorVerificationSpecialtyType>().notNull(),
    verificationMethod: text('verification_method')
      .$type<DoctorVerificationMethodType>()
      .notNull(),
    licenseNumber: text('license_number'),
    clinicEmail: text('clinic_email'),
    applicantStatementAccepted: boolean('applicant_statement_accepted').notNull().default(false),
    // Nullable to allow the applicant to upload a document before formally submitting.
    submittedAt: timestamp('submitted_at', { mode: 'date' }),
    reviewedAt: timestamp('reviewed_at', { mode: 'date' }),
    reviewedByAdminId: text('reviewed_by_admin_id'),
    adminNotes: text('admin_notes'),
    userFacingNote: text('user_facing_note'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index('doctor_verification_application_user_id_idx').on(table.userId),
      statusIdx: index('doctor_verification_application_status_idx').on(table.status),
      submittedAtIdx: index('doctor_verification_application_submitted_at_idx').on(
        table.submittedAt,
      ),
    };
  },
);

// Doctor verification file (exactly one file per application) (Feature F13)
export const doctorVerificationFileSchema = pgTable(
  'doctor_verification_file',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    applicationId: uuid('application_id').notNull(),
    originalName: text('original_name').notNull(),
    storedName: text('stored_name').notNull(),
    // Relative to FILES_STORAGE_PATH
    relativePath: text('relative_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      applicationIdUnique: uniqueIndex('doctor_verification_file_application_id_uidx').on(
        table.applicationId,
      ),
      createdAtIdx: index('doctor_verification_file_created_at_idx').on(table.createdAt),
    };
  },
);

export const episodeSchema = pgTable(
  'episode',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id').notNull(),
    // Unified "Attack" classification (migraine vs non-migraine headache)
    attackType: text('attack_type').$type<'migraine' | 'headache'>().notNull().default('migraine'),
    startTime: timestamp('start_time', { mode: 'date' }).notNull(),
    // True onset time as reported by the user. May be earlier than start_time
    // (which on quick-add equals log time). Falls back to start_time when null.
    onsetAt: timestamp('onset_at', { mode: 'date' }),
    endTime: timestamp('end_time', { mode: 'date' }),
    isOngoing: boolean('is_ongoing').notNull().default(false),
    // Episode stale reminder tracking (48h "episode not closed" notification)
    staleReminderSentAt: timestamp('stale_reminder_sent_at', {
      mode: 'date',
      withTimezone: true,
    }),
    staleReminderCount: integer('stale_reminder_count').notNull().default(0),
    intensity: integer('intensity').notNull(),
    painLocation: text('pain_location').notNull(),
    painLocationOther: text('pain_location_other'),
    painType: text('pain_type').notNull(),
    painTypeOther: text('pain_type_other'),
    symptoms: jsonb('symptoms').$type<string[]>().notNull().default([]),
    symptomsOther: text('symptoms_other'),
    medications: jsonb('medications')
      .$type<Array<{ name: string; dose?: string; takenAt?: string }>>()
      .notNull()
      .default([]),
    triggers: jsonb('triggers').$type<string[]>().notNull().default([]),
    protectors: jsonb('protectors').$type<string[]>().notNull().default([]),
    triggersOther: text('triggers_other'),
    notes: text('notes'),
    // Weather Pain Index linkage
    weatherPainIndexId: uuid('weather_pain_index_id'),
    weatherContext: jsonb('weather_context').$type<WeatherContextData | null>(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdStartTimeIdx: index('episode_user_id_start_time_idx').on(
        table.userId,
        table.startTime,
      ),
      userIdAttackTypeIdx: index('episode_user_id_attack_type_idx').on(
        table.userId,
        table.attackType,
      ),
      staleReminderSentAtIdx: index('episode_stale_reminder_sent_at_idx').on(
        table.staleReminderSentAt,
      ),
    };
  },
);

// Factor taxonomy (minimal; supports trigger/protector/symptom classification)
export const FactorType = {
  TRIGGER: 'trigger',
  PROTECTOR: 'protector',
  SYMPTOM: 'symptom',
} as const;
export type FactorTypeType = (typeof FactorType)[keyof typeof FactorType];

export const factorSchema = pgTable(
  'factor',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // NULL userId = global/built-in factor. Non-NULL = user-defined.
    userId: text('user_id'),
    // Optional stable key (e.g. 'episode.trigger:stress'); unique per (user_id, key) when present.
    key: text('key'),
    type: text('type').$type<FactorTypeType>().notNull(),
    displayName: text('display_name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdIdx: index('factor_user_id_idx').on(table.userId),
      typeIdx: index('factor_type_idx').on(table.type),
      userKeyUidx: uniqueIndex('factor_user_key_uidx').on(table.userId, table.key),
    };
  },
);

export const factorEventSchema = pgTable(
  'factor_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    factorId: uuid('factor_id')
      .notNull()
      .references(() => factorSchema.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { mode: 'date', withTimezone: true }).notNull(),
    intensity: integer('intensity'),
    source: text('source').notNull().default('diary'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userOccurredAtIdx: index('factor_event_user_id_occurred_at_idx').on(
        table.userId,
        table.occurredAt,
      ),
      factorOccurredAtIdx: index('factor_event_factor_id_occurred_at_idx').on(
        table.factorId,
        table.occurredAt,
      ),
    };
  },
);

export const insightsCacheSchema = pgTable(
  'insights_cache',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    windowDays: integer('window_days').notNull(),
    methodVersion: text('method_version').notNull(),
    computedAt: timestamp('computed_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    stale: boolean('stale').notNull().default(false),
    payloadJson: jsonb('payload_json').notNull().$type<unknown>(),
    inputStatsJson: jsonb('input_stats_json').$type<unknown>(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userWindowMethodUidx: uniqueIndex('insights_cache_user_window_method_uidx').on(
        table.userId,
        table.windowDays,
        table.methodVersion,
      ),
      userIdIdx: index('insights_cache_user_id_idx').on(table.userId),
    };
  },
);

export const InsightTestPlanDirection = {
  REDUCE: 'reduce',
  INCREASE: 'increase',
} as const;
export type InsightTestPlanDirectionType
  = (typeof InsightTestPlanDirection)[keyof typeof InsightTestPlanDirection];

export const InsightTestPlanStatus = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;
export type InsightTestPlanStatusType
  = (typeof InsightTestPlanStatus)[keyof typeof InsightTestPlanStatus];

export const insightTestPlanSchema = pgTable(
  'insight_test_plan',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    factorId: uuid('factor_id')
      .notNull()
      .references(() => factorSchema.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<InsightTestPlanDirectionType>().notNull(),
    startDate: date('start_date', { mode: 'date' }).notNull(),
    durationDays: integer('duration_days').notNull().default(14),
    notes: text('notes'),
    reminderEnabled: boolean('reminder_enabled').notNull().default(true),
    status: text('status')
      .$type<InsightTestPlanStatusType>()
      .notNull()
      .default(InsightTestPlanStatus.ACTIVE),
    completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdIdx: index('insight_test_plan_user_id_idx').on(table.userId),
      userStatusIdx: index('insight_test_plan_user_status_idx').on(table.userId, table.status),
      factorIdx: index('insight_test_plan_factor_id_idx').on(table.factorId),
    };
  },
);

// Medication library (Feature F16.1)
export const medicationsCatalogSchema = pgTable(
  'medications_catalog',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    canonicalName: text('canonical_name').notNull(),
    // Normalized (lowercased) canonical name for case-insensitive dedupe/upserts.
    canonicalNameLc: text('canonical_name_lc').notNull().default(''),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    // Precomputed search text (canonical + aliases) to support fast fuzzy search via trigram GIN.
    searchText: text('search_text').notNull().default(''),
    // e.g. ['acute', 'preventive', 'triptan'] - free-form, used for filtering/search
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      canonicalNameIdx: index('medications_catalog_canonical_name_idx').on(
        table.canonicalName,
      ),
      canonicalNameLcUidx: uniqueIndex('medications_catalog_canonical_name_lc_uidx').on(
        table.canonicalNameLc,
      ),
    };
  },
);

export const MedicationClass = {
  TRIPTAN: 'triptan',
  ERGOTAMINE: 'ergotamine',
  COMBINATION_ANALGESIC: 'combination_analgesic',
  OPIOID: 'opioid',
  NON_OPIOID_SIMPLE_ANALGESIC: 'non_opioid_simple_analgesic',
} as const;
export type MedicationClassType = (typeof MedicationClass)[keyof typeof MedicationClass];

export const DoseHelped = {
  YES: 'yes',
  PARTLY: 'partly',
  NO: 'no',
} as const;
export type DoseHelpedType = (typeof DoseHelped)[keyof typeof DoseHelped];

export const userMedicationsSchema = pgTable(
  'user_medications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    catalogMedicationId: uuid('catalog_medication_id').references(
      () => medicationsCatalogSchema.id,
      { onDelete: 'set null' },
    ),
    customName: text('custom_name'),
    // Text to allow flexible entries like "1/2" or "2.5"
    defaultDose: text('default_dose'),
    defaultUnit: text('default_unit'),
    // Whether the default unit is custom free-text (vs a constrained option)
    defaultUnitIsCustom: boolean('default_unit_is_custom').notNull().default(false),
    // Last used values are updated during logging and power 1-tap quick add.
    lastUsedDose: text('last_used_dose'),
    lastUsedUnit: text('last_used_unit'),
    lastUsedUnitIsCustom: boolean('last_used_unit_is_custom').notNull().default(false),
    lastUsedAt: timestamp('last_used_at', { mode: 'date', withTimezone: true }),
    medicationClass: text('medication_class')
      .$type<MedicationClassType>()
      .notNull()
      .default(MedicationClass.NON_OPIOID_SIMPLE_ANALGESIC),
    isAcute: boolean('is_acute').notNull().default(true),
    isPinned: boolean('is_pinned').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdIdx: index('user_medications_user_id_idx').on(table.userId),
      pinnedIdx: index('user_medications_user_id_is_pinned_idx').on(
        table.userId,
        table.isPinned,
      ),
      catalogIdIdx: index('user_medications_catalog_medication_id_idx').on(
        table.catalogMedicationId,
      ),
    };
  },
);

export const medicationIntakesSchema = pgTable(
  'medication_intakes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    // Nullable for legacy migrations where we only have a medication name string.
    userMedicationId: uuid('user_medication_id').references(() => userMedicationsSchema.id, {
      onDelete: 'cascade',
    }),
    // Fallback medication name for legacy / migrated rows where userMedicationId is unknown.
    medicationName: text('medication_name'),
    episodeId: integer('episode_id').references(() => episodeSchema.id, {
      onDelete: 'set null',
    }),
    takenAt: timestamp('taken_at', { mode: 'date', withTimezone: true }).notNull(),
    // Stored separately from the user's default, because the user can override per-intake.
    dose: text('dose'),
    unit: text('unit'),
    unitIsCustom: boolean('unit_is_custom').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdTakenAtIdx: index('medication_intakes_user_id_taken_at_idx').on(
        table.userId,
        table.takenAt,
      ),
      userMedicationTakenAtIdx: index(
        'medication_intakes_user_medication_id_taken_at_idx',
      ).on(table.userMedicationId, table.takenAt),
      episodeIdIdx: index('medication_intakes_episode_id_idx').on(table.episodeId),
    };
  },
);

export const acuteDosesSchema = pgTable(
  'acute_doses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    medicationId: uuid('medication_id')
      .notNull()
      .references(() => userMedicationsSchema.id, { onDelete: 'cascade' }),
    attackId: integer('attack_id').references(() => episodeSchema.id, {
      onDelete: 'set null',
    }),
    takenAt: timestamp('taken_at', { mode: 'date', withTimezone: true }).notNull(),
    dose: text('dose'),
    unit: text('unit'),
    unitIsCustom: boolean('unit_is_custom').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userTakenAtIdx: index('acute_doses_user_id_taken_at_idx').on(table.userId, table.takenAt),
      medicationTakenAtIdx: index('acute_doses_medication_id_taken_at_idx').on(
        table.medicationId,
        table.takenAt,
      ),
      attackIdIdx: index('acute_doses_attack_id_idx').on(table.attackId),
    };
  },
);

export const doseOutcomesSchema = pgTable(
  'dose_outcomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    doseId: uuid('dose_id')
      .notNull()
      .references(() => acuteDosesSchema.id, { onDelete: 'cascade' }),
    helped: text('helped').$type<DoseHelpedType>().notNull(),
    backToNormalFunction: boolean('back_to_normal_function'),
    timeToReliefMinutes: integer('time_to_relief_minutes'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      doseUniqueIdx: uniqueIndex('dose_outcomes_dose_id_uidx').on(table.doseId),
      userCreatedIdx: index('dose_outcomes_user_id_created_at_idx').on(table.userId, table.createdAt),
    };
  },
);

// Preventive treatment plans (Feature F40)
export const PreventivePlanKind = {
  ORAL: 'oral',
  INJECTION: 'injection',
  INFUSION: 'infusion',
  DEVICE: 'device',
  SUPPLEMENT: 'supplement',
  OTHER: 'other',
} as const;
export type PreventivePlanKindType = (typeof PreventivePlanKind)[keyof typeof PreventivePlanKind];

export const PreventiveScheduleType = {
  DAILY: 'daily',
  WEEKDAYS: 'weekdays',
  EVERY_N_DAYS: 'every_n_days',
  EVERY_N_WEEKS: 'every_n_weeks',
  CUSTOM_WEEKDAYS: 'custom_weekdays',
  ON_SPECIFIC_DATES: 'on_specific_dates',
} as const;
export type PreventiveScheduleTypeType
  = (typeof PreventiveScheduleType)[keyof typeof PreventiveScheduleType];

export const PreventivePlanStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  STOPPED: 'stopped',
} as const;
export type PreventivePlanStatusType
  = (typeof PreventivePlanStatus)[keyof typeof PreventivePlanStatus];

export const PreventiveStopReason = {
  SIDE_EFFECTS: 'side_effects',
  NOT_HELPING: 'not_helping',
  COMPLETED: 'completed',
  COST: 'cost',
  OTHER: 'other',
} as const;
export type PreventiveStopReasonType
  = (typeof PreventiveStopReason)[keyof typeof PreventiveStopReason];

export const PreventiveIntakeState = {
  TAKEN: 'taken',
  MISSED: 'missed',
  UNSURE: 'unsure',
} as const;
export type PreventiveIntakeStateType
  = (typeof PreventiveIntakeState)[keyof typeof PreventiveIntakeState];

export const PreventiveSideEffect = {
  NONE: 'none',
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
} as const;
export type PreventiveSideEffectType
  = (typeof PreventiveSideEffect)[keyof typeof PreventiveSideEffect];

export const PreventiveStillTaking = {
  YES: 'yes',
  PAUSED: 'paused',
  STOPPED: 'stopped',
} as const;
export type PreventiveStillTakingType
  = (typeof PreventiveStillTaking)[keyof typeof PreventiveStillTaking];

export const preventivePlanSchema = pgTable(
  'preventive_plan',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    catalogMedicationId: uuid('catalog_medication_id').references(
      () => medicationsCatalogSchema.id,
      { onDelete: 'set null' },
    ),
    name: text('name').notNull(),
    kind: text('kind').$type<PreventivePlanKindType>().notNull(),
    doseText: text('dose_text'),
    scheduleType: text('schedule_type').$type<PreventiveScheduleTypeType>().notNull(),
    schedulePayload: jsonb('schedule_payload').$type<unknown>().notNull().default({}),
    startDate: date('start_date', { mode: 'date' }).notNull(),
    // Feature F42: reminders. Times of day (user-local HH:mm) at which a dose is
    // expected. The schedule above decides *which days*; these decide *when*.
    reminderTimes: jsonb('reminder_times').$type<string[]>().notNull().default([]),
    remindersEnabled: boolean('reminders_enabled').notNull().default(false),
    status: text('status')
      .$type<PreventivePlanStatusType>()
      .notNull()
      .default(PreventivePlanStatus.ACTIVE),
    pausedAt: timestamp('paused_at', { mode: 'date' }),
    stoppedAt: timestamp('stopped_at', { mode: 'date' }),
    stopReason: text('stop_reason').$type<PreventiveStopReasonType>(),
    stopReasonNote: text('stop_reason_note'),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdIdx: index('preventive_plan_user_id_idx').on(table.userId),
      userStatusIdx: index('preventive_plan_user_status_idx').on(table.userId, table.status),
      userMedicationIdx: index('preventive_plan_user_medication_idx').on(
        table.userId,
        table.catalogMedicationId,
      ),
    };
  },
);

export const preventiveIntakeEventSchema = pgTable(
  'preventive_intake_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => preventivePlanSchema.id, { onDelete: 'cascade' }),
    localDate: date('local_date', { mode: 'date' }).notNull(),
    state: text('state').$type<PreventiveIntakeStateType>().notNull(),
    takenAt: timestamp('taken_at', { mode: 'date' }),
    note: text('note'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      planLocalDateUidx: uniqueIndex('preventive_intake_plan_local_date_uidx').on(
        table.planId,
        table.localDate,
      ),
      userLocalDateIdx: index('preventive_intake_user_local_date_idx').on(
        table.userId,
        table.localDate,
      ),
      planLocalDateIdx: index('preventive_intake_plan_local_date_idx').on(
        table.planId,
        table.localDate,
      ),
    };
  },
);

/**
 * Feature F42: one row per reminder actually pushed, keyed by the slot it was
 * fired for. The unique index is what makes the cron idempotent — re-running a
 * tick, or running it more often than the reminder resolution, never
 * double-notifies.
 */
export const preventiveReminderLogSchema = pgTable(
  'preventive_reminder_log',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => preventivePlanSchema.id, { onDelete: 'cascade' }),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    // The scheduled slot this reminder belongs to, user-local HH:mm.
    timeSlot: text('time_slot').notNull(),
    sentAt: timestamp('sent_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      planDateSlotUidx: uniqueIndex('preventive_reminder_log_plan_date_slot_uidx').on(
        table.planId,
        table.localDate,
        table.timeSlot,
      ),
      userDateIdx: index('preventive_reminder_log_user_date_idx').on(
        table.userId,
        table.localDate,
      ),
    };
  },
);

export const preventiveWeeklyCheckInSchema = pgTable(
  'preventive_weekly_check_in',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => preventivePlanSchema.id, { onDelete: 'cascade' }),
    weekStartLocalDate: date('week_start_local_date', { mode: 'date' }).notNull(),
    sideEffects: text('side_effects').$type<PreventiveSideEffectType>().notNull(),
    stillTaking: text('still_taking').$type<PreventiveStillTakingType>().notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      planWeekUidx: uniqueIndex('preventive_checkin_plan_week_uidx').on(
        table.planId,
        table.weekStartLocalDate,
      ),
      userIdIdx: index('preventive_checkin_user_id_idx').on(table.userId),
    };
  },
);

export const preventiveStatusChangeSchema = pgTable(
  'preventive_status_change',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => preventivePlanSchema.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status').$type<PreventivePlanStatusType>().notNull(),
    toStatus: text('to_status').$type<PreventivePlanStatusType>().notNull(),
    changedAt: timestamp('changed_at', { mode: 'date' }).defaultNow().notNull(),
    reason: text('reason'),
    reasonNote: text('reason_note'),
  },
  (table) => {
    return {
      planIdIdx: index('preventive_status_change_plan_id_idx').on(table.planId),
      userIdIdx: index('preventive_status_change_user_id_idx').on(table.userId),
    };
  },
);

// Questionnaire runs (Features F33/F34/F35)
export const QuestionnaireType = {
  HIT6: 'HIT6',
  MIDAS: 'MIDAS',
  MSQ21: 'MSQ21',
} as const;
export type QuestionnaireTypeType = (typeof QuestionnaireType)[keyof typeof QuestionnaireType];

export const questionnaireResponseSchema = pgTable(
  'questionnaire_responses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    type: text('type').$type<QuestionnaireTypeType>().notNull(),
    takenAt: timestamp('taken_at', { mode: 'date', withTimezone: true }).notNull(),
    periodStart: timestamp('period_start', { mode: 'date', withTimezone: true }),
    periodEnd: timestamp('period_end', { mode: 'date', withTimezone: true }),
    answers: jsonb('answers').notNull(),
    scoreTotal: integer('score_total'),
    scoreDetails: jsonb('score_details'),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdIdx: index('questionnaire_responses_user_id_idx').on(table.userId),
      userTypeTakenAtIdx: index('questionnaire_responses_user_type_taken_at_idx').on(
        table.userId,
        table.type,
        table.takenAt,
      ),
    };
  },
);

// Outcome settings (Feature F32)
export const userOutcomeSettingsSchema = pgTable(
  'user_outcome_settings',
  {
    userId: text('user_id').primaryKey(),
    baselineStart: timestamp('baseline_start', { mode: 'date', withTimezone: true }),
    baselineEnd: timestamp('baseline_end', { mode: 'date', withTimezone: true }),
    preferredWindowDays: integer('preferred_window_days').notNull().default(28),
    acuteOutcomeReminderEnabled: boolean('acute_outcome_reminder_enabled').notNull().default(false),
    timezone: text('timezone'),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdIdx: uniqueIndex('user_outcome_settings_user_id_uidx').on(table.userId),
    };
  },
);

// Weather Context data stored with episodes
export type WeatherContextData = {
  wpiScore: number;
  wpiLevel: 'low' | 'moderate' | 'high' | 'very_high';
  kpIndex: number | null;
  deltaPressure: number;
  temperatureDeviation: number;
  humidity: number;
  windSpeed: number;
  uvi: number;
  components?: {
    pressureFactor: number;
    humidityFactor: number;
    tempFactor: number;
    windFactor: number;
    uviFactor: number;
    solarFactor: number;
  };
};

// User weather settings - per-user location for WPI calculation
export const userWeatherSettingsSchema = pgTable(
  'user_weather_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull().unique(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    locationLabel: text('location_label'),
    timezone: text('timezone').notNull().default('UTC'),
    units: text('units').notNull().default('metric'),
    // Whether daily risk alerts are enabled for this user
    alertsEnabled: boolean('alerts_enabled').notNull().default(false),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdIdx: uniqueIndex('user_weather_settings_user_id_idx').on(table.userId),
      // Index for efficient querying by timezone when alerts are enabled
      timezoneAlertsIdx: index('user_weather_settings_tz_alerts_idx').on(
        table.timezone,
        table.alertsEnabled,
      ),
    };
  },
);

// Weather daily snapshot - aggregated weather data per (lat, lon, date)
export const weatherDailySnapshotSchema = pgTable(
  'weather_daily_snapshot',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    date: date('date', { mode: 'date' }).notNull(),
    source: text('source').notNull().default('openweathermap'),
    deltaPressure: doublePrecision('delta_pressure').notNull(),
    temperatureDeviation: doublePrecision('temperature_deviation').notNull(),
    avgHumidity: doublePrecision('avg_humidity').notNull(),
    avgWindSpeed: doublePrecision('avg_wind_speed').notNull(),
    uvi: doublePrecision('uvi').notNull(),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      latLonDateIdx: uniqueIndex('weather_daily_snapshot_lat_lon_date_idx').on(
        table.lat,
        table.lon,
        table.date,
      ),
    };
  },
);

// Solar activity snapshot - Kp index data
export const solarActivitySnapshotSchema = pgTable(
  'solar_activity_snapshot',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    timestampUtc: timestamp('timestamp_utc', { mode: 'date', withTimezone: true }).notNull(),
    kpIndex: doublePrecision('kp_index').notNull(),
    source: text('source').notNull().default('noaa'),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      timestampSourceIdx: uniqueIndex('solar_activity_timestamp_source_idx').on(
        table.timestampUtc,
        table.source,
      ),
    };
  },
);

// Weather Pain Index snapshot - computed WPI per user at a given moment
export const weatherPainIndexSnapshotSchema = pgTable(
  'weather_pain_index_snapshot',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    timestampLocal: timestamp('timestamp_local', { mode: 'date', withTimezone: true }).notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    weatherSnapshotId: uuid('weather_snapshot_id'),
    solarSnapshotId: uuid('solar_snapshot_id'),
    wpiScore: doublePrecision('wpi_score').notNull(),
    wpiLevel: text('wpi_level').$type<'low' | 'moderate' | 'high' | 'very_high'>().notNull(),
    components: jsonb('components').$type<{
      pressureFactor: number;
      humidityFactor: number;
      tempFactor: number;
      windFactor: number;
      uviFactor: number;
      solarFactor: number;
    }>().notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdTimestampIdx: index('wpi_snapshot_user_id_timestamp_idx').on(
        table.userId,
        table.timestampLocal,
      ),
    };
  },
);

// Community post - main entity for the community playground
export const communityPostSchema = pgTable(
  'community_post',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    authorId: text('author_id').notNull(),
    episodeId: integer('episode_id'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    // Comma-separated tags for v1; can be normalized later
    tags: text('tags'),
    isAnonymous: boolean('is_anonymous').notNull().default(true),
    isFromEpisode: boolean('is_from_episode').notNull().default(false),
    visibility: text('visibility')
      .$type<'PUBLIC' | 'HIDDEN' | 'DELETED'>()
      .notNull()
      .default('PUBLIC'),
    score: integer('score').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      postAuthorIdx: index('community_post_author_id_idx').on(table.authorId),
      postCreatedAtIdx: index('community_post_created_at_idx').on(table.createdAt),
      postScoreIdx: index('community_post_score_created_at_idx').on(
        table.score,
        table.createdAt,
      ),
    };
  },
);

// Community comments (1-level nesting supported via parentCommentId)
export const communityCommentSchema = pgTable(
  'community_comment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    postId: uuid('post_id').notNull(),
    authorId: text('author_id').notNull(),
    parentCommentId: uuid('parent_comment_id'),
    body: text('body').notNull(),
    isAnonymous: boolean('is_anonymous').notNull().default(true),
    visibility: text('visibility')
      .$type<'PUBLIC' | 'HIDDEN' | 'DELETED'>()
      .notNull()
      .default('PUBLIC'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      commentPostIdx: index('community_comment_post_id_idx').on(table.postId),
      commentParentIdx: index('community_comment_parent_id_idx').on(
        table.parentCommentId,
      ),
    };
  },
);

// Community votes (one per user per post)
export const communityVoteSchema = pgTable(
  'community_vote',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    postId: uuid('post_id').notNull(),
    userId: text('user_id').notNull(),
    // +1, -1; 0 is represented as row deletion in v1
    value: integer('value').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      votePostIdx: index('community_vote_post_id_idx').on(table.postId),
      voteUserPostUniqueIdx: uniqueIndex('community_vote_post_user_unique_idx').on(
        table.postId,
        table.userId,
      ),
    };
  },
);

// Report reason enum
export const ReportReason = {
  SPAM: 'spam',
  ABUSE: 'abuse',
  MISINFORMATION: 'misinformation',
  OTHER: 'other',
} as const;

export type ReportReasonType = (typeof ReportReason)[keyof typeof ReportReason];

// Report status enum
export const ReportStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;

export type ReportStatusType = (typeof ReportStatus)[keyof typeof ReportStatus];

// Community reports - moderation hooks for posts & comments
export const communityReportSchema = pgTable(
  'community_report',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    postId: uuid('post_id'),
    commentId: uuid('comment_id'),
    reporterId: text('reporter_id').notNull(),
    reason: text('reason').$type<ReportReasonType>().notNull(),
    details: text('details'),
    status: text('status')
      .$type<ReportStatusType>()
      .notNull()
      .default('OPEN'),
    // Moderation resolution fields
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      reportPostIdx: index('community_report_post_id_idx').on(table.postId),
      reportCommentIdx: index('community_report_comment_id_idx').on(
        table.commentId,
      ),
      reportReporterIdx: index('community_report_reporter_id_idx').on(
        table.reporterId,
      ),
      reportStatusIdx: index('community_report_status_idx').on(table.status),
    };
  },
);

export const featureRequestSchema = pgTable(
  'feature_request',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    resolution: text('resolution')
      .$type<FeatureRequestResolutionType>()
      .notNull()
      .default(FeatureRequestResolution.SENT),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      featureRequestUserIdIdx: index('feature_request_user_id_idx').on(table.userId),
      featureRequestResolutionIdx: index('feature_request_resolution_idx').on(
        table.resolution,
      ),
      featureRequestCreatedAtIdx: index('feature_request_created_at_idx').on(
        table.createdAt,
      ),
    };
  },
);

// User consents - track explicit consent for GDPR compliance
export const userConsentSchema = pgTable(
  'user_consent',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    // Type of consent: 'health_data', 'terms', 'privacy', 'analytics'
    consentType: text('consent_type').$type<'health_data' | 'terms' | 'privacy' | 'analytics'>().notNull(),
    // Version of the policy/terms when consent was given
    version: text('version').notNull().default('1.0'),
    // When consent was given
    givenAt: timestamp('given_at', { mode: 'date' }).notNull().defaultNow(),
    // When consent was withdrawn (null if still active)
    withdrawnAt: timestamp('withdrawn_at', { mode: 'date' }),
    // IP address when consent was given (for audit)
    ipAddress: text('ip_address'),
    // User agent when consent was given (for audit)
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      userConsentTypeIdx: uniqueIndex('user_consent_user_type_idx').on(
        table.userId,
        table.consentType,
      ),
      userIdIdx: index('user_consent_user_id_idx').on(table.userId),
    };
  },
);

export const appointmentPrepSchema = pgTable(
  'appointment_prep',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    appointmentDate: date('appointment_date', { mode: 'date' }).notNull(),
    visitLabel: text('visit_label'),
    clinicianName: text('clinician_name'),
    visitReason: text('visit_reason'),
    topConcerns: jsonb('top_concerns').$type<string[]>().notNull().default([]),
    doctorQuestions: jsonb('doctor_questions').$type<string[]>().notNull().default([]),
    personalNotes: text('personal_notes'),
    compareWindowDays: integer('compare_window_days').notNull().default(90),
    generatedSnapshot: jsonb('generated_snapshot').$type<AppointmentPrepSnapshot>().notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    userAppointmentDateIdx: index('appointment_prep_user_date_idx').on(
      table.userId,
      table.appointmentDate,
    ),
  }),
);

// Doctor share links - secure short-links for sharing migraine data with doctors
export const doctorShareLinkSchema = pgTable(
  'doctor_share_link',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    // Unique token for the share link (URL-safe random string)
    token: text('token').notNull().unique(),
    // Optional label for the patient to identify the link (e.g., "Dr. Smith appointment")
    label: text('label'),
    // Optional recipient info (doctor name, for display purposes only)
    recipientName: text('recipient_name'),
    // Patient display name shown to doctor (first name only for privacy)
    patientDisplayName: text('patient_display_name'),
    // Link expiration timestamp
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
    // Date range filter for episodes (null = all time)
    dateRangeStart: timestamp('date_range_start', { mode: 'date' }),
    dateRangeEnd: timestamp('date_range_end', { mode: 'date' }),
    appointmentPrepId: uuid('appointment_prep_id').references(() => appointmentPrepSchema.id, {
      onDelete: 'set null',
    }),
    // Number of times the link has been accessed
    accessCount: integer('access_count').notNull().default(0),
    // Last accessed timestamp
    lastAccessedAt: timestamp('last_accessed_at', { mode: 'date' }),
    // Whether the link has been revoked
    isRevoked: boolean('is_revoked').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      tokenIdx: uniqueIndex('doctor_share_link_token_idx').on(table.token),
      userIdIdx: index('doctor_share_link_user_id_idx').on(table.userId),
    };
  },
);

// Risk alert run status
export const RiskAlertStatus = {
  SENT: 'sent',
  SKIPPED: 'skipped',
  FAILED: 'failed',
} as const;

export type RiskAlertStatusType = (typeof RiskAlertStatus)[keyof typeof RiskAlertStatus];

// Risk alert type
export const RiskAlertType = {
  DAILY_RISK: 'daily_risk',
} as const;

export type RiskAlertTypeValue = (typeof RiskAlertType)[keyof typeof RiskAlertType];

// Diary day backbone (unified Daily Diary + Attacks)
export const DiaryDayType = {
  HEADACHE_FREE: 'headache_free',
  HEADACHE_DAY: 'headache_day',
  MIGRAINE_DAY: 'migraine_day',
} as const;
export type DiaryDayTypeType = (typeof DiaryDayType)[keyof typeof DiaryDayType];

export const DiaryDayCreatedFrom = {
  USER: 'user',
  ATTACK: 'attack',
} as const;
export type DiaryDayCreatedFromType = (typeof DiaryDayCreatedFrom)[keyof typeof DiaryDayCreatedFrom];

// Risk alert run - tracks sent alerts to prevent duplicates
export const riskAlertRunSchema = pgTable(
  'risk_alert_run',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    // Local date in YYYY-MM-DD format (in user's timezone)
    localDate: text('local_date').notNull(),
    // Type of alert (currently only daily_risk)
    type: text('type').$type<RiskAlertTypeValue>().notNull(),
    // Status of the alert run
    status: text('status').$type<RiskAlertStatusType>().notNull(),
    // Additional details about the run (wpiMax, solarLevel, timezone, etc.)
    details: jsonb('details').$type<{
      wpiScore?: number;
      wpiLevel?: string;
      // Future-storm forecast (from GFZ raw) used for alert decision
      solarForecastKp?: number | null;
      solarForecastTimestampUtc?: string | null;
      solarHigh?: boolean;
      wpiHigh?: boolean;
      timezone?: string;
      errorMessage?: string;
    }>(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      // Unique constraint: one alert per user per date per type
      userDateTypeIdx: uniqueIndex('risk_alert_run_user_date_type_idx').on(
        table.userId,
        table.localDate,
        table.type,
      ),
      // Index for querying by user
      userIdIdx: index('risk_alert_run_user_id_idx').on(table.userId),
      // Index for querying recent runs
      createdAtIdx: index('risk_alert_run_created_at_idx').on(table.createdAt),
    };
  },
);

// Push subscriptions - Web Push notification subscriptions per user/device
export const pushSubscriptionSchema = pgTable(
  'push_subscription',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    // The unique push endpoint URL from the browser
    endpoint: text('endpoint').notNull().unique(),
    // VAPID public key (p256dh) - base64url encoded
    p256dh: text('p256dh').notNull(),
    // Auth secret - base64url encoded
    auth: text('auth').notNull(),
    // Optional expiration time from the subscription
    expirationTime: bigint('expiration_time', { mode: 'number' }),
    // User agent string for device identification (optional)
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      endpointIdx: uniqueIndex('push_subscription_endpoint_idx').on(table.endpoint),
      userIdIdx: index('push_subscription_user_id_idx').on(table.userId),
    };
  },
);

export const CyclePrivacyMode = {
  LOCAL_ONLY: 'local_only',
  ACCOUNT_SYNC: 'account_sync',
} as const;
export type CyclePrivacyModeType = (typeof CyclePrivacyMode)[keyof typeof CyclePrivacyMode];

export const CycleHormoneProfile = {
  UNKNOWN: 'unknown',
  NONE: 'none',
  COMBINED_PILL: 'combined_pill',
  PROGESTIN_ONLY_PILL: 'progestin_only_pill',
  HORMONAL_IUD: 'hormonal_iud',
  IMPLANT: 'implant',
  INJECTION: 'injection',
  PATCH_RING: 'patch_ring',
  HRT: 'hrt',
  OTHER: 'other',
  PREFER_NOT_TO_SAY: 'prefer_not_to_say',
} as const;
export type CycleHormoneProfileType = (typeof CycleHormoneProfile)[keyof typeof CycleHormoneProfile];

export const CycleFlow = {
  UNSPECIFIED: 'unspecified',
  LIGHT: 'light',
  MEDIUM: 'medium',
  HEAVY: 'heavy',
} as const;
export type CycleFlowType = (typeof CycleFlow)[keyof typeof CycleFlow];

export const CycleBleedingSource = {
  USER: 'user',
} as const;
export type CycleBleedingSourceType = (typeof CycleBleedingSource)[keyof typeof CycleBleedingSource];

export const cycleSettingsSchema = pgTable(
  'cycle_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    includeInExports: boolean('include_in_exports').notNull().default(false),
    privacyMode: text('privacy_mode')
      .$type<CyclePrivacyModeType>()
      .notNull()
      .default(CyclePrivacyMode.LOCAL_ONLY),
    perimenstrualWindowStartDays: integer('perimenstrual_window_start_days').notNull().default(-2),
    perimenstrualWindowEndDays: integer('perimenstrual_window_end_days').notNull().default(3),
    hormoneProfile: text('hormone_profile')
      .$type<CycleHormoneProfileType>()
      .notNull()
      .default(CycleHormoneProfile.UNKNOWN),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userIdUidx: uniqueIndex('cycle_settings_user_id_uidx').on(table.userId),
      userIdIdx: index('cycle_settings_user_id_idx').on(table.userId),
    };
  },
);

export const cycleBleedingDaySchema = pgTable(
  'cycle_bleeding_day',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    localDate: date('local_date', { mode: 'date' }).notNull(),
    bleeding: boolean('bleeding').notNull().default(true),
    flow: text('flow').$type<CycleFlowType>().notNull().default(CycleFlow.UNSPECIFIED),
    source: text('source')
      .$type<CycleBleedingSourceType>()
      .notNull()
      .default(CycleBleedingSource.USER),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => {
    return {
      userDateUidx: uniqueIndex('cycle_bleeding_day_user_id_local_date_uidx').on(
        table.userId,
        table.localDate,
      ),
      userDateIdx: index('cycle_bleeding_day_user_id_local_date_idx').on(
        table.userId,
        table.localDate,
      ),
    };
  },
);

// Diary day entry - exactly one row per (user, local calendar date).
// IMPORTANT: Missing = absence of row (do NOT represent missing with a row).
export const dailyDiaryEntrySchema = pgTable(
  'daily_diary_entry',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    // Local calendar DATE in the user's timezone at time of entry (audit with timezone column).
    localDate: date('local_date', { mode: 'date' }).notNull(),
    timezone: text('timezone').notNull(),
    // Day classification (4 states total; "missing" is absence of row).
    dayType: text('day_type').$type<DiaryDayTypeType>().notNull(),
    // Provenance: whether this row exists because the user checked in, or because an attack touches the day.
    createdFrom: text('created_from').$type<DiaryDayCreatedFromType>().notNull().default('user'),
    // Optional details (validated in service layer)
    impact: integer('impact'),
    notes: text('notes'),
    bedTimeLocal: time('bed_time_local'),
    wakeTimeLocal: time('wake_time_local'),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      userLocalDateUidx: uniqueIndex('daily_diary_entry_user_id_local_date_uidx').on(
        table.userId,
        table.localDate,
      ),
      userLocalDateIdx: index('daily_diary_entry_user_id_local_date_idx').on(
        table.userId,
        table.localDate,
      ),
    };
  },
);

// ─── Programs Module ──────────────────────────────────────────────────────────

export const programSettingsSchema = pgTable('program_settings', {
  userId: text('user_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  notificationsConfig: jsonb('notifications_config')
    .$type<{
    windDown?: boolean;
    morningCheckIn?: boolean;
    onsetNudge?: boolean;
    weeklyDigest?: boolean;
  }>()
    .notNull()
    .default({}),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type ProgramEnrollmentStatus = 'active' | 'paused' | 'ended';
export type SleepTargetPayload = {
  bedTime: string; // 'HH:MM'
  wakeTime: string; // 'HH:MM'
  toleranceMinutes: number;
};
export type ProgramTargetPayload = SleepTargetPayload | Record<string, unknown>;

export const programEnrollmentSchema = pgTable(
  'program_enrollment',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id').notNull(),
    programId: text('program_id').notNull(),
    status: text('status').$type<ProgramEnrollmentStatus>().notNull(),
    targetPayload: jsonb('target_payload').$type<ProgramTargetPayload>().notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    baselineWindowStart: date('baseline_window_start', { mode: 'string' }).notNull(),
    baselineWindowEnd: date('baseline_window_end', { mode: 'string' }).notNull(),
    evaluationWindowStart: date('evaluation_window_start', { mode: 'string' }).notNull(),
    evaluationWindowEnd: date('evaluation_window_end', { mode: 'string' }).notNull(),
    rampDays: integer('ramp_days').notNull().default(14),
    timezone: text('timezone').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    userIdx: index('program_enrollment_user_idx').on(table.userId),
  }),
);

export type ProgramAdherenceSignal = 'hit' | 'miss' | 'na';
export type ProgramAdherenceSource = 'diary' | 'episode' | 'computed' | 'notification';

export const programAdherenceEventSchema = pgTable('program_adherence_event', {
  id: serial('id').primaryKey(),
  enrollmentId: integer('enrollment_id')
    .notNull()
    .references(() => programEnrollmentSchema.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  programId: text('program_id').notNull(),
  localDate: date('local_date', { mode: 'string' }),
  attackId: integer('attack_id').references(() => episodeSchema.id, { onDelete: 'cascade' }),
  signal: text('signal').$type<ProgramAdherenceSignal>().notNull(),
  source: text('source').$type<ProgramAdherenceSource>().notNull(),
  payload: jsonb('payload').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const programRecommendationDismissalSchema = pgTable(
  'program_recommendation_dismissal',
  {
    userId: text('user_id').notNull(),
    programId: text('program_id').notNull(),
    dismissedAt: timestamp('dismissed_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.userId, table.programId] }),
  }),
);

export type ProgramNotificationKind
  = | 'wind_down'
    | 'morning_check_in'
    | 'onset_nudge'
    | 'weekly_digest'
    | 'eval_complete';

export const programNotificationLogSchema = pgTable('program_notification_log', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  programId: text('program_id').notNull(),
  kind: text('kind').$type<ProgramNotificationKind>().notNull(),
  localDate: date('local_date', { mode: 'string' }).notNull(),
  attackId: integer('attack_id').references(() => episodeSchema.id, { onDelete: 'cascade' }),
  sentAt: timestamp('sent_at', { mode: 'date' }).defaultNow().notNull(),
});

/**
 * Lease-based lock preventing overlapping cron runs.
 *
 * One row per job. A run acquires the lease by claiming the row when the
 * previous lease has expired; the lease auto-expires so a crashed process
 * never leaves a job permanently locked.
 */
export const cronRunLockSchema = pgTable('cron_run_lock', {
  jobName: text('job_name').primaryKey(),
  lockedAt: timestamp('locked_at', { mode: 'date' }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  runId: text('run_id').notNull(),
});

/**
 * One row per MCP tool call, written best-effort.
 *
 * Deliberately records no arguments or payloads, so the table holds no health
 * data — it answers "which AI client did what, when" and nothing more.
 */
export const mcpToolCallAuditSchema = pgTable(
  'mcp_tool_call_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    toolName: text('tool_name').notNull(),
    clientId: text('client_id'),
    outcome: text('outcome').notNull(),
    errorCode: text('error_code'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('mcp_tool_call_audit_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const intakeResponseSchema = pgTable('intake_response', {
  userId: text('user_id').primaryKey(),
  version: integer('version').notNull().default(1),
  status: text('status').$type<'in_progress' | 'completed' | 'skipped'>().notNull().default('in_progress'),
  currentStep: integer('current_step').notNull().default(0),
  answers: jsonb('answers').$type<unknown>().notNull().default({}),
  seeded: jsonb('seeded').$type<unknown>().notNull().default({}),
  completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});
