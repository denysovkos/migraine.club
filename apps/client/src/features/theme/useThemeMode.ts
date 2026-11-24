'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { useUserProfileContext } from '@/features/auth/UserProfileProvider';

/**
 * Resolved light/dark state plus a toggle that also persists the choice as the
 * saved theme preference, so the nav toggle and the settings switch agree.
 */
export function useThemeMode() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { themePreference, updateThemePreference } = useUserProfileContext();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && (resolvedTheme ?? theme) === 'dark';

  const toggleTheme = async () => {
    const nextTheme = isDark ? 'light' : 'dark';
    setTheme(nextTheme);

    const saved = await updateThemePreference(nextTheme);

    if (!saved && themePreference) {
      setTheme(themePreference);
    }
  };

  return { mounted, isDark, toggleTheme };
}
