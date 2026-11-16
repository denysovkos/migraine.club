import { describe, expect, it, vi } from 'vitest';

import { updateProfileSchema } from './validation';

const authMock = vi.fn();
const currentUserMock = vi.fn();

vi.mock('@clerk/nextjs/server', () => ({
  auth: authMock,
  currentUser: currentUserMock,
}));

const getOrCreateProfileMock = vi.fn();
const updateProfileMock = vi.fn();

vi.mock('@/services/UserProfileService', () => ({
  userProfileService: {
    getOrCreateProfile: getOrCreateProfileMock,
    updateProfile: updateProfileMock,
  },
}));

describe('/api/user/profile', () => {
  it('accepts light and dark themePreference values and rejects unsupported values', async () => {
    expect(updateProfileSchema.safeParse({ themePreference: 'light' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ themePreference: 'dark' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ themePreference: 'system' }).success).toBe(false);
  });

  it('returns themePreference in the GET profile payload', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    currentUserMock.mockResolvedValue({
      firstName: 'A',
      lastName: 'B',
      username: 'ab',
      publicMetadata: {},
    });
    getOrCreateProfileMock.mockResolvedValue({
      id: 'user-1',
      displayName: 'Ada',
      preferredLanguage: 'en',
      themePreference: 'dark',
      isDoctor: false,
      isDoctorVerified: false,
      createdAt: new Date('2026-03-29T10:00:00.000Z'),
      updatedAt: new Date('2026-03-29T10:00:00.000Z'),
    });

    const mod = await import('./route');
    const res = await mod.GET(new Request('http://localhost/api/user/profile'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.themePreference).toBe('dark');
  });
});
