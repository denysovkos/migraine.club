import { DateTime } from 'luxon';
import { z } from 'zod';

const YmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const clinicianReportSectionIds = [
  'cover',
  'summary',
  'trends',
  'attacks',
  'medications',
  'diary',
  'insights',
  'cycle_hormones',
] as const;

export type ClinicianReportSectionId = (typeof clinicianReportSectionIds)[number];

export const clinicianReportConfigSchema = z.object({
  template: z.enum(['quick', 'full', 'custom']).default('quick'),
  rangePreset: z.enum(['last30', 'last90', 'last180', 'custom']).default('last90'),
  from: YmdSchema.optional(),
  to: YmdSchema.optional(),
  appointmentPrepId: z.string().guid().optional(),
  sections: z
    .object({
      cover: z.boolean().default(true),
      summary: z.boolean().default(true),
      trends: z.boolean().default(true),
      attacks: z.boolean().default(true),
      medications: z.boolean().default(true),
      diary: z.boolean().default(true),
      insights: z.boolean().default(true),
      cycle_hormones: z.boolean().default(false),
    })
    .default({
      cover: true,
      summary: true,
      trends: true,
      attacks: true,
      medications: true,
      diary: true,
      insights: true,
      cycle_hormones: false,
    }),
}).superRefine((value, ctx) => {
  if (value.rangePreset !== 'custom') {
    return;
  }
  if (!value.from || !value.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Custom range requires from and to values.',
    });
    return;
  }
  if (value.from > value.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Custom range must have from <= to.',
    });
  }
});

export type ClinicianReportConfigInput = z.input<typeof clinicianReportConfigSchema>;
export type ClinicianReportConfig = z.output<typeof clinicianReportConfigSchema>;

export type ClinicianReportResolvedRange = {
  from: string;
  to: string;
};

export function resolveClinicianReportRange(args: {
  config: ClinicianReportConfig;
  timezone: string;
  nowUtc?: Date;
}): ClinicianReportResolvedRange {
  const now = DateTime.fromJSDate(args.nowUtc ?? new Date(), { zone: args.timezone }).startOf('day');
  if (args.config.rangePreset === 'custom') {
    if (!args.config.from || !args.config.to) {
      throw new Error('Custom range requires "from" and "to".');
    }
    const from = DateTime.fromISO(args.config.from, { zone: args.timezone }).startOf('day');
    const to = DateTime.fromISO(args.config.to, { zone: args.timezone }).startOf('day');
    if (!from.isValid || !to.isValid || from > to) {
      throw new Error('Invalid custom date range.');
    }
    return {
      from: from.toISODate()!,
      to: to.toISODate()!,
    };
  }

  const days = args.config.rangePreset === 'last30'
    ? 30
    : args.config.rangePreset === 'last180'
      ? 180
      : 90;

  return {
    from: now.minus({ days: days - 1 }).toISODate()!,
    to: now.toISODate()!,
  };
}

export function resolveSections(config: ClinicianReportConfig): ClinicianReportSectionId[] {
  if (config.template === 'quick') {
    return ['summary'];
  }
  if (config.template === 'full') {
    return ['cover', 'summary', 'trends', 'attacks', 'medications', 'diary', 'insights', 'cycle_hormones'];
  }
  return clinicianReportSectionIds.filter(id => config.sections[id]);
}
