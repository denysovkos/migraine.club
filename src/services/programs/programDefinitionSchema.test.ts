import { describe, expect, it } from 'vitest';

import { ProgramDefinitionFrontmatter } from './programDefinitionSchema';

describe('ProgramDefinitionFrontmatter', () => {
  it('parses sleep-regularity-shaped frontmatter', () => {
    const result = ProgramDefinitionFrontmatter.safeParse({
      id: 'sleep-regularity',
      title: 'Sleep Regularity',
      shape: 'daily-habit',
      durationWeeks: 6,
      adherenceMetric: 'bedtime-wake-window',
      defaultTarget: { bedTime: '23:00', wakeTime: '07:00', toleranceMinutes: 30 },
      recommendationTriggers: [
        { kind: 'factor-frequency', factor: 'sleep', values: ['poor', 'fair'], minDays: 5, windowDays: 14 },
      ],
      citations: [{ id: 'vgontzas-2020', label: 'Vgontzas 2020', doi: '10.1212/WNL.0000000000010012' }],
      disclaimer: 'Discuss with your doctor.',
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid bedTime format', () => {
    const result = ProgramDefinitionFrontmatter.safeParse({
      id: 'sleep-regularity',
      title: 'Sleep Regularity',
      shape: 'daily-habit',
      durationWeeks: 6,
      adherenceMetric: 'bedtime-wake-window',
      defaultTarget: { bedTime: '25:99', wakeTime: '07:00', toleranceMinutes: 30 },
      recommendationTriggers: [],
      citations: [],
      disclaimer: 'x',
    });

    expect(result.success).toBe(false);
  });
});
