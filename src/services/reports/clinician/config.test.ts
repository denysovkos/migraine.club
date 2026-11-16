import { describe, expect, it } from 'vitest';

import { clinicianReportConfigSchema, resolveSections } from '@/services/reports/clinician/config';

describe('clinician report config validation', () => {
  it('parses defaults for minimal config', () => {
    const parsed = clinicianReportConfigSchema.parse({});

    expect(parsed.template).toBe('quick');
    expect(parsed.rangePreset).toBe('last90');
    expect(parsed.sections.cycle_hormones).toBe(false);
  });

  it('requires valid custom range', () => {
    expect(() => clinicianReportConfigSchema.parse({
      rangePreset: 'custom',
      from: '2026-01-10',
      to: '2026-01-01',
    })).toThrowError(/Custom range must have from <= to/);
  });

  it('includes cycle_hormones in full template sections', () => {
    const parsed = clinicianReportConfigSchema.parse({
      template: 'full',
    });

    expect(resolveSections(parsed)).toContain('cycle_hormones');
  });
});
