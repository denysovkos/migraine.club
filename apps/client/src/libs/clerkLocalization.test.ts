import { enUS } from '@clerk/localizations/en-US';
import { frFR } from '@clerk/localizations/fr-FR';
import { ukUA } from '@clerk/localizations/uk-UA';
import { describe, expect, it } from 'vitest';

import { clerkLocalization, loadClerkLocalization } from './clerkLocalization';

describe('clerkLocalization', () => {
  it('serves English until a locale is loaded, then that locale', async () => {
    expect(clerkLocalization('en')).toBe(enUS);
    expect(clerkLocalization('fr')).toBe(enUS);

    await loadClerkLocalization('fr');
    await loadClerkLocalization('uk');
    await loadClerkLocalization('en');

    expect(clerkLocalization('fr')).toEqual(frFR);
    expect(clerkLocalization('uk')).toEqual(ukUA);
    expect(clerkLocalization('en')).toBe(enUS);
    expect(clerkLocalization('de')).toBe(enUS);
  });
});
