import { z } from 'zod';

import { SupportedLanguages, ThemePreferences } from '@/models/Schema';

export const updateProfileSchema = z.object({
  displayName: z.string()
    .min(2, 'Display name must be at least 2 characters')
    .max(50, 'Display name must be at most 50 characters')
    .optional(),
  preferredLanguage: z.enum(SupportedLanguages as unknown as [string, ...string[]])
    .optional(),
  themePreference: z.enum(ThemePreferences as unknown as [string, ...string[]])
    .optional(),
});
