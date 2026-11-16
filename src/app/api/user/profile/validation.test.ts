import { describe, expect, it } from 'vitest';

import { updateProfileSchema } from './validation';

describe('profile theme preference validation', () => {
  it('accepts light and dark themePreference values', () => {
    expect(updateProfileSchema.safeParse({ themePreference: 'light' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ themePreference: 'dark' }).success).toBe(true);
  });

  it('rejects unsupported themePreference values', () => {
    expect(updateProfileSchema.safeParse({ themePreference: 'system' }).success).toBe(false);
  });
});
