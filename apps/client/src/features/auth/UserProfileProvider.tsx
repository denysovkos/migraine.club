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

  useEffect(() => {
    // Only proceed once Clerk has loaded
    if (!isUserLoaded) {
      return;
    }

    // Skip for non-authenticated users
    if (!isSignedIn || !user) {
      setIsLoading(false);
      return;
    }

    // Fetch the profile and optionally redirect to preferred locale
    const initProfile = async () => {
      const profile = await fetchProfile();
      setIsLoading(false);

      // Only redirect once per session and if locale doesn't match
      if (profile && !hasRedirected && profile.preferredLanguage !== currentLocale) {
        const supportedLocales = AppConfig.locales.map(l => l.id);

        if (supportedLocales.includes(profile.preferredLanguage)) {
          // Redirect to the user's preferred locale
          const pathParts = pathname.split('/');
          const localeInPath = pathParts[1];

          // Check if there's a locale prefix in the path
          if (localeInPath && supportedLocales.includes(localeInPath)) {
            // Replace the existing locale
            pathParts[1] = profile.preferredLanguage;
          } else if (profile.preferredLanguage !== AppConfig.defaultLocale) {
            // Add locale prefix only if not default
            pathParts.splice(1, 0, profile.preferredLanguage);
          }

          const newPath = pathParts.join('/') || '/';
          setHasRedirected(true);
          router.replace(newPath);
        }
      }
    };

    initProfile();
  }, [isUserLoaded, isSignedIn, user, currentLocale, pathname, router, hasRedirected, fetchProfile]);

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
