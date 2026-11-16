'use client';

import { ThemeProvider, useTheme } from 'next-themes';
import { useEffect, useRef } from 'react';

import { useUserProfileContext } from '@/features/auth/UserProfileProvider';

function ThemeSynchronizer() {
  const { themePreference } = useUserProfileContext();
  const { setTheme } = useTheme();
  const lastAppliedRef = useRef<string | null>(null);

  // `setTheme` gets a new identity on every theme change, so this effect re-runs
  // after any toggle. Only re-apply when the saved preference itself changed,
  // otherwise a toggle would immediately be reverted to the stale preference.
  useEffect(() => {
    if (!themePreference || themePreference === lastAppliedRef.current) {
      return;
    }

    lastAppliedRef.current = themePreference;
    setTheme(themePreference);
  }, [setTheme, themePreference]);

  return null;
}

export function AuthenticatedThemeProvider(props: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <ThemeSynchronizer />
      {props.children}
    </ThemeProvider>
  );
}
