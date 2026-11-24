'use client';

import type { SupportedLanguageType, ThemePreferenceType } from '@migraine/db/schema';

import { useCallback, useEffect, useState } from 'react';

export type UserProfile = {
  id: string;
  displayName: string;
  preferredLanguage: SupportedLanguageType;
  themePreference: ThemePreferenceType;
  isDoctor: boolean;
  isDoctorVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpdateProfileData = {
  displayName?: string;
  preferredLanguage?: SupportedLanguageType;
  themePreference?: ThemePreferenceType;
};

type UseUserProfileReturn = {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  updateProfile: (data: UpdateProfileData) => Promise<boolean>;
  refetch: () => Promise<void>;
};

export function useUserProfile(): UseUserProfileReturn {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/user/profile');

      if (!response.ok) {
        throw new Error('Failed to fetch profile');
      }

      const data = await response.json();
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateProfile = useCallback(async (data: UpdateProfileData): Promise<boolean> => {
    try {
      setError(null);

      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update profile');
      }

      const updatedProfile = await response.json();
      setProfile(updatedProfile);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      return false;
    }
  }, []);

  return {
    profile,
    loading,
    error,
    updateProfile,
    refetch: fetchProfile,
  };
}
