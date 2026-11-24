'use client';

import type { SupportedLanguageType, ThemePreferenceType } from '@migraine/db/schema';
import { useUser } from '@clerk/nextjs';
import { usePathname, useRouter } from 'next/navigation';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppConfig } from '@/utils/AppConfig';

type UserProfileContextType = {
  displayName: string | null;
  preferredLanguage: SupportedLanguageType | null;
  themePreference: ThemePreferenceType | null;
  isLoading: boolean;
  setThemePreferencePreview: (nextTheme: ThemePreferenceType) => void;
  updateThemePreference: (nextTheme: ThemePreferenceType) => Promise<boolean>;
  refetch: () => Promise<void>;
};

const UserProfileContext = createContext<UserProfileContextType>({
  displayName: null,
  preferredLanguage: null,
  themePreference: null,
  isLoading: true,
  setThemePreferencePreview: () => {},
  updateThemePreference: async () => false,
  refetch: async () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export function useUserProfileContext() {
  return useContext(UserProfileContext);
}

/**
 * Provider that ensures user profile is synced to DB on first load
 * and redirects to preferred locale if needed.
 */
export function UserProfileProvider({
  children,
  currentLocale,
}: {
  children: React.ReactNode;
  currentLocale: string;
}) {
  const { isLoaded: isUserLoaded, isSignedIn, user } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState<SupportedLanguageType | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreferenceType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasRedirected, setHasRedirected] = useState(false);

  const syncProfileState = useCallback((profile: {
    displayName: string;
    preferredLanguage: SupportedLanguageType;
    themePreference: ThemePreferenceType;
  }) => {
    setDisplayName(profile.displayName);
    setPreferredLanguage(profile.preferredLanguage);
    setThemePreference(profile.themePreference);
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      const response = await fetch('/api/user/profile');
      if (response.ok) {
        const profile = await response.json();
        syncProfileState(profile);
        return profile;
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    }
    return null;
  }, [syncProfileState]);

  const updateThemePreference = useCallback(async (nextTheme: ThemePreferenceType) => {
    const previousTheme = themePreference;
    setThemePreference(nextTheme);

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ themePreference: nextTheme }),
      });

      if (!response.ok) {
        throw new Error('Failed to update theme preference');
      }

      const updatedProfile = await response.json();
      syncProfileState(updatedProfile);
      return true;
    } catch {
      setThemePreference(previousTheme);
      return false;
    }
  }, [syncProfileState, themePreference]);

  const setThemePreferencePreview = useCallback((nextTheme: ThemePreferenceType) => {
    setThemePreference(nextTheme);
  }, []);

  // The profile is fetched once per signed-in user. Clerk hands out a new
  // user object on every session refresh, and pages change without the
  // profile changing, so neither refetches it.
  const userId = user?.id;
  useEffect(() => {
    // Only proceed once Clerk has loaded
    if (!isUserLoaded) {
      return;
    }

    // Skip for non-authenticated users
    if (!isSignedIn || !userId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    fetchProfile().then(() => {
      if (!cancelled) {
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isUserLoaded, isSignedIn, userId, fetchProfile]);

  // Redirect to the preferred locale, once per session, if it differs.
  useEffect(() => {
    if (isLoading || !preferredLanguage || hasRedirected || preferredLanguage === currentLocale) {
      return;
    }
    const supportedLocales = AppConfig.locales.map(l => l.id);
    if (!supportedLocales.includes(preferredLanguage)) {
      return;
    }
    const pathParts = pathname.split('/');
    const localeInPath = pathParts[1];

    // Check if there's a locale prefix in the path
    if (localeInPath && supportedLocales.includes(localeInPath)) {
      // Replace the existing locale
      pathParts[1] = preferredLanguage;
    } else if (preferredLanguage !== AppConfig.defaultLocale) {
      // Add locale prefix only if not default
      pathParts.splice(1, 0, preferredLanguage);
    }

    const newPath = pathParts.join('/') || '/';
    setHasRedirected(true);
    router.replace(newPath);
  }, [isLoading, preferredLanguage, currentLocale, pathname, router, hasRedirected]);

  const contextValue = useMemo(() => ({
    displayName,
    preferredLanguage,
    themePreference,
    isLoading,
    setThemePreferencePreview,
    updateThemePreference,
    refetch: fetchProfile,
  }), [displayName, preferredLanguage, themePreference, isLoading, setThemePreferencePreview, updateThemePreference, fetchProfile]);

  return (
    <UserProfileContext.Provider value={contextValue}>
      {children}
    </UserProfileContext.Provider>
  );
}
