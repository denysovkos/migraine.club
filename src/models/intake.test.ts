import { describe, expect, it } from 'vitest';

import { IntakeAnswersSchema, IntakeBlockPatchSchema } from './intake';

describe('IntakeAnswersSchema', () => {
  it('accepts a fully empty object — nothing answered yet', () => {
    const parsed = IntakeAnswersSchema.parse({});

    expect(parsed.frequency).toBeNull();
    expect(parsed.triggers).toBeNull();
    expect(parsed.medications).toBeNull();
    expect(parsed.habits).toBeNull();
  });

  it('distinguishes a skipped block (null) from an answered-but-empty one', () => {
    const parsed = IntakeAnswersSchema.parse({
      triggers: { keys: [], custom: [] },
    });

    expect(parsed.triggers).toEqual({ keys: [], custom: [] });
    expect(parsed.frequency).toBeNull();
  });

  it('rejects an unknown frequency band', () => {
    expect(() => IntakeAnswersSchema.parse({ frequency: { band: 'sometimes' } })).toThrow();
  });

  it('rejects a bed time that is not HH:mm', () => {
    expect(() =>
      IntakeAnswersSchema.parse({
        habits: { sleepTrouble: 'often', typicalBed: '11pm', typicalWake: '07:00', medTiming: 'lt30' },
      }),
    ).toThrow();
  });

  it('rejects an acute medication entry with neither a catalog id nor a custom name', () => {
    expect(() =>
      IntakeAnswersSchema.parse({
        medications: { acute: [{}], preventive: [] },
      }),
    ).toThrow();
  });

  it('accepts an acute medication entry identified only by custom name', () => {
    const parsed = IntakeAnswersSchema.parse({
      medications: { acute: [{ customName: 'Ibuprofen' }], preventive: [] },
    });

    expect(parsed.medications?.acute).toHaveLength(1);
  });
});

describe('IntakeBlockPatchSchema', () => {
  it('accepts a frequency block patch', () => {
    const parsed = IntakeBlockPatchSchema.parse({
      block: 'frequency',
      value: { band: '4_7' },
    });

    expect(parsed.block).toBe('frequency');
  });

  it('accepts an explicit null value, meaning the user skipped this step', () => {
    const parsed = IntakeBlockPatchSchema.parse({ block: 'habits', value: null });

    expect(parsed.value).toBeNull();
  });

  it('rejects a patch whose value does not match its block', () => {
    expect(() =>
      IntakeBlockPatchSchema.parse({ block: 'frequency', value: { keys: [], custom: [] } }),
    ).toThrow();
  });
});
