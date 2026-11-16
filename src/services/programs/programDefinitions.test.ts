import { describe, expect, it } from 'vitest';

import { getProgramDefinition, getProgramDefinitions } from './programDefinitions';

describe('programDefinitions', () => {
  it('loads sleep-regularity', () => {
    const def = getProgramDefinition('sleep-regularity');

    expect(def).toBeDefined();
    expect(def?.frontmatter.title).toBe('Sleep Regularity');
    expect(def?.frontmatter.adherenceMetric).toBe('bedtime-wake-window');
    expect(def?.body.length).toBeGreaterThan(0);
  });

  it('returns undefined for unknown id', () => {
    expect(getProgramDefinition('nope')).toBeUndefined();
  });

  it('returns all definitions sorted by id', () => {
    const all = getProgramDefinitions();

    expect(all.length).toBeGreaterThan(0);
    expect(all.map(d => d.frontmatter.id)).toEqual(['acute-med-timing', 'sleep-regularity']);
  });

  it('loads acute-med-timing', () => {
    const def = getProgramDefinition('acute-med-timing');

    expect(def).toBeDefined();
    expect(def?.frontmatter.adherenceMetric).toBe('onset-to-dose');
    expect(def?.frontmatter.shape).toBe('per-attack-rule');
  });
});
