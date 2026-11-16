import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Env', () => ({ Env: { FILES_STORAGE_PATH: '/tmp' } }));

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const isAdminMock = vi.fn();
vi.mock('@/services/ModerationService', () => ({
  moderationService: { isAdmin: isAdminMock },
}));

describe('GET /api/admin/doctor-verification/files/:fileId', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    isAdminMock.mockResolvedValueOnce(false);

    const mod = await import('./route');
    const res = await mod.GET(new Request('http://localhost'), {
      params: Promise.resolve({ fileId: 'file-1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when not admin', async () => {
    authMock.mockResolvedValueOnce({ userId: 'user-1' });
    isAdminMock.mockResolvedValueOnce(false);

    const mod = await import('./route');
    const res = await mod.GET(new Request('http://localhost'), {
      params: Promise.resolve({ fileId: 'file-1' }),
    });

    expect(res.status).toBe(403);
  });
});
