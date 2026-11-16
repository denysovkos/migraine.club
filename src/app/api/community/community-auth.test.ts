import { beforeEach, describe, expect, it, vi } from 'vitest';

// These routes used to rely on the proxy's createRouteMatcher for auth. They
// must now reject signed-out callers themselves, before touching any data.
const authMock = vi.fn();
const listPosts = vi.fn();
const getPostWithComments = vi.fn();
const dbSelect = vi.fn();

vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }));
vi.mock('@/services/CommunityService', () => ({
  communityService: { listPosts, getPostWithComments },
}));
vi.mock('@/libs/DB', () => ({ db: { select: dbSelect, selectDistinct: dbSelect } }));
vi.mock('@/libs/Logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

describe('community API auth', () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue({ userId: null });
    listPosts.mockReset();
    getPostWithComments.mockReset();
    dbSelect.mockReset();
  });

  it('GET /api/community/posts returns 401 when signed out', async () => {
    const { GET } = await import('./posts/route');

    const res = await GET(new Request('http://localhost/api/community/posts'));

    expect(res.status).toBe(401);
    expect(listPosts).not.toHaveBeenCalled();
  });

  it('GET /api/community/posts/:id returns 401 when signed out', async () => {
    const { GET } = await import('./posts/[id]/route');

    const res = await GET(new Request('http://localhost/api/community/posts/abc'), {
      params: Promise.resolve({ id: 'abc' }),
    });

    expect(res.status).toBe(401);
    expect(getPostWithComments).not.toHaveBeenCalled();
  });

  it('GET /api/community/stats returns 401 when signed out', async () => {
    const { GET } = await import('./stats/route');

    const res = await GET();

    expect(res.status).toBe(401);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it('GET /api/community/posts passes the signed-in user to the service', async () => {
    authMock.mockResolvedValue({ userId: 'user_123' });
    listPosts.mockResolvedValue([]);
    const { GET } = await import('./posts/route');

    const res = await GET(new Request('http://localhost/api/community/posts'));

    expect(res.status).toBe(200);
    expect(listPosts).toHaveBeenCalledWith('user_123', expect.any(Object));
  });
});
