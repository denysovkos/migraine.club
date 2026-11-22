import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { ZipEntry } from './zip';
import { asc, eq, getTableColumns, getTableName, inArray } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  acuteDosesSchema,
  appointmentPrepSchema,
  communityCommentSchema,
  communityPostSchema,
  communityReportSchema,
  communityVoteSchema,
  cycleBleedingDaySchema,
  cycleSettingsSchema,
  dailyDiaryEntrySchema,
  doctorShareLinkSchema,
  doctorVerificationApplicationSchema,
  doctorVerificationFileSchema,
  doseOutcomesSchema,
  episodePainReadingSchema,
  episodeSchema,
  factorEventSchema,
  factorSchema,
  featureRequestSchema,
  insightTestPlanSchema,
  intakeResponseSchema,
  mcpToolCallAuditSchema,
  medicationIntakesSchema,
  preventiveIntakeEventSchema,
  preventivePlanSchema,
  preventiveReminderLogSchema,
  preventiveStatusChangeSchema,
  preventiveWeeklyCheckInSchema,
  programAdherenceEventSchema,
  programEnrollmentSchema,
  programNotificationLogSchema,
  programRecommendationDismissalSchema,
  programSettingsSchema,
  pushSubscriptionSchema,
  questionnaireResponseSchema,
  reliefSessionSchema,
  riskAlertRunSchema,
  userConsentSchema,
  userMedicationsSchema,
  userOutcomeSettingsSchema,
  userSchema,
  userWeatherSettingsSchema,
  weatherPainIndexSnapshotSchema,
} from '@/models/Schema';

import { toCsv } from './csv';
import { createZip } from './zip';

export const DATA_EXPORT_FORMAT_VERSION = '1';

type Row = Record<string, unknown>;

type ExportTableSpec = {
  table: PgTable;
  /** Column that scopes rows to the requesting user. */
  ownerColumn: PgColumn;
  /**
   * Columns left out of the export: credentials (share tokens, push keys),
   * payment-provider identifiers and staff-only moderation fields. Everything
   * else the user owns is included.
   */
  omit?: readonly string[];
};

/**
 * Every table holding data that belongs to a user. Global reference data
 * (medication catalogue, weather/solar snapshots), caches that are re-derived
 * on demand (insights_cache) and plumbing (idempotent_request, cron locks)
 * are intentionally absent.
 *
 * When adding a user-scoped table to the schema, add it here too.
 */
export const EXPORT_TABLES: readonly ExportTableSpec[] = [
  {
    table: userSchema,
    ownerColumn: userSchema.id,
    omit: ['stripeCustomerId', 'stripeSubscriptionId', 'stripeSubscriptionPriceId'],
  },
  { table: userConsentSchema, ownerColumn: userConsentSchema.userId },
  { table: intakeResponseSchema, ownerColumn: intakeResponseSchema.userId },
  { table: episodeSchema, ownerColumn: episodeSchema.userId },
  { table: episodePainReadingSchema, ownerColumn: episodePainReadingSchema.userId },
  { table: reliefSessionSchema, ownerColumn: reliefSessionSchema.userId },
  { table: dailyDiaryEntrySchema, ownerColumn: dailyDiaryEntrySchema.userId },
  { table: factorSchema, ownerColumn: factorSchema.userId },
  { table: factorEventSchema, ownerColumn: factorEventSchema.userId },
  { table: userMedicationsSchema, ownerColumn: userMedicationsSchema.userId },
  { table: medicationIntakesSchema, ownerColumn: medicationIntakesSchema.userId },
  { table: acuteDosesSchema, ownerColumn: acuteDosesSchema.userId },
  { table: doseOutcomesSchema, ownerColumn: doseOutcomesSchema.userId },
  { table: preventivePlanSchema, ownerColumn: preventivePlanSchema.userId },
  { table: preventiveIntakeEventSchema, ownerColumn: preventiveIntakeEventSchema.userId },
  { table: preventiveWeeklyCheckInSchema, ownerColumn: preventiveWeeklyCheckInSchema.userId },
  { table: preventiveStatusChangeSchema, ownerColumn: preventiveStatusChangeSchema.userId },
  { table: preventiveReminderLogSchema, ownerColumn: preventiveReminderLogSchema.userId },
  { table: questionnaireResponseSchema, ownerColumn: questionnaireResponseSchema.userId },
  { table: userOutcomeSettingsSchema, ownerColumn: userOutcomeSettingsSchema.userId },
  { table: insightTestPlanSchema, ownerColumn: insightTestPlanSchema.userId },
  { table: cycleSettingsSchema, ownerColumn: cycleSettingsSchema.userId },
  { table: cycleBleedingDaySchema, ownerColumn: cycleBleedingDaySchema.userId },
  { table: userWeatherSettingsSchema, ownerColumn: userWeatherSettingsSchema.userId },
  { table: weatherPainIndexSnapshotSchema, ownerColumn: weatherPainIndexSnapshotSchema.userId },
  { table: riskAlertRunSchema, ownerColumn: riskAlertRunSchema.userId },
  { table: programSettingsSchema, ownerColumn: programSettingsSchema.userId },
  { table: programEnrollmentSchema, ownerColumn: programEnrollmentSchema.userId },
  { table: programAdherenceEventSchema, ownerColumn: programAdherenceEventSchema.userId },
  { table: programRecommendationDismissalSchema, ownerColumn: programRecommendationDismissalSchema.userId },
  { table: programNotificationLogSchema, ownerColumn: programNotificationLogSchema.userId },
  { table: appointmentPrepSchema, ownerColumn: appointmentPrepSchema.userId },
  { table: doctorShareLinkSchema, ownerColumn: doctorShareLinkSchema.userId, omit: ['token'] },
  {
    table: pushSubscriptionSchema,
    ownerColumn: pushSubscriptionSchema.userId,
    omit: ['endpoint', 'p256dh', 'auth'],
  },
  { table: communityPostSchema, ownerColumn: communityPostSchema.authorId },
  { table: communityCommentSchema, ownerColumn: communityCommentSchema.authorId },
  { table: communityVoteSchema, ownerColumn: communityVoteSchema.userId },
  { table: communityReportSchema, ownerColumn: communityReportSchema.reporterId, omit: ['resolvedBy'] },
  { table: featureRequestSchema, ownerColumn: featureRequestSchema.userId },
  {
    table: doctorVerificationApplicationSchema,
    ownerColumn: doctorVerificationApplicationSchema.userId,
    omit: ['reviewedByAdminId', 'adminNotes'],
  },
  { table: mcpToolCallAuditSchema, ownerColumn: mcpToolCallAuditSchema.userId },
];

/** Server-side storage location of uploaded verification documents. */
const DOCTOR_VERIFICATION_FILE_OMIT = ['storedName', 'relativePath'] as const;

export type UserDataExport = {
  format: 'migraine.club/user-data-export';
  formatVersion: string;
  exportedAt: string;
  userId: string;
  tables: Record<string, Row[]>;
};

function pickColumns(table: PgTable, omit: readonly string[] = []): Record<string, PgColumn> {
  const columns = { ...getTableColumns(table) } as Record<string, PgColumn>;
  for (const key of omit) {
    delete columns[key];
  }
  return columns;
}

/** Column names per exported table, so empty tables still get a CSV header. */
function exportedColumnNames(): Record<string, string[]> {
  const names: Record<string, string[]> = {};
  for (const spec of EXPORT_TABLES) {
    names[getTableName(spec.table)] = Object.keys(pickColumns(spec.table, spec.omit));
  }
  names[getTableName(doctorVerificationFileSchema)] = Object.keys(
    pickColumns(doctorVerificationFileSchema, DOCTOR_VERIFICATION_FILE_OMIT),
  );
  return names;
}

function orderColumn(columns: Record<string, PgColumn>): PgColumn | undefined {
  return columns.createdAt ?? columns.id;
}

async function selectRows(
  table: PgTable,
  columns: Record<string, PgColumn>,
  where: ReturnType<typeof eq>,
): Promise<Row[]> {
  const query = db.select(columns).from(table).where(where);
  const order = orderColumn(columns);
  return (order ? await query.orderBy(asc(order)) : await query) as Row[];
}

export async function collectUserData(userId: string, now: Date = new Date()): Promise<UserDataExport> {
  const tables: Record<string, Row[]> = {};

  for (const spec of EXPORT_TABLES) {
    const columns = pickColumns(spec.table, spec.omit);
    tables[getTableName(spec.table)] = await selectRows(spec.table, columns, eq(spec.ownerColumn, userId));
  }

  // Verification files are owned through their application, not by user id.
  const applicationIds = (tables[getTableName(doctorVerificationApplicationSchema)] ?? [])
    .map(row => row.id)
    .filter((id): id is string => typeof id === 'string');
  const fileColumns = pickColumns(doctorVerificationFileSchema, DOCTOR_VERIFICATION_FILE_OMIT);
  tables[getTableName(doctorVerificationFileSchema)] = applicationIds.length > 0
    ? await selectRows(
        doctorVerificationFileSchema,
        fileColumns,
        inArray(doctorVerificationFileSchema.applicationId, applicationIds),
      )
    : [];

  return {
    format: 'migraine.club/user-data-export',
    formatVersion: DATA_EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    userId,
    tables,
  };
}

export function exportFileBaseName(now: Date): string {
  return `migraine-club-export-${now.toISOString().slice(0, 10)}`;
}

export function serializeJsonExport(data: UserDataExport): string {
  return JSON.stringify(data, null, 2);
}

const CSV_README = `migraine.club data export

Each CSV file holds one kind of record, named after the database table it
comes from. Times are UTC in ISO 8601 format. Fields that hold lists or
structured values are written as JSON text inside the cell. Text that starts
with = + - or @ is prefixed with a single quote so spreadsheet apps do not run
it as a formula.

Share-link tokens, notification keys and payment-provider identifiers are left
out because they are credentials, not personal data.

The same data in a single machine-readable file is available as JSON from
Settings > Privacy.
`;

/** UTF-8 byte order mark so spreadsheet apps detect the encoding. */
const BOM = '﻿';

export function buildCsvArchive(data: UserDataExport): Uint8Array {
  const entries: ZipEntry[] = [{ name: 'README.txt', data: CSV_README }];
  const manifest = {
    format: data.format,
    formatVersion: data.formatVersion,
    exportedAt: data.exportedAt,
    userId: data.userId,
    counts: Object.fromEntries(Object.entries(data.tables).map(([name, rows]) => [name, rows.length])),
  };
  entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });

  const columnNames = exportedColumnNames();
  for (const [name, rows] of Object.entries(data.tables)) {
    entries.push({ name: `${name}.csv`, data: BOM + toCsv(rows, columnNames[name]) });
  }

  return createZip(entries, new Date(data.exportedAt));
}

export function countRows(data: UserDataExport): number {
  return Object.values(data.tables).reduce((sum, rows) => sum + rows.length, 0);
}
