import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'super-secret-value';

const envMock: { CRON_SECRET?: string } = {};
vi.mock('@/libs/Env', () => ({ Env: envMock }));

vi.mock('@/libs/DB', () => ({ db: {} }));

vi.mock('@/libs/Logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const releaseMock = vi.fn(async () => undefined);
const acquireCronLeaseMock = vi.fn(async (jobName: string) => ({
  jobName,
  runId: 'run-1',
  release: releaseMock,
}));

vi.mock('@/libs/cronLock', () => ({ acquireCronLease: acquireCronLeaseMock }));

type RouteConfig = Parameters<typeof import('./withCron').createCronRoute>[0];

async function buildRoute(overrides: Partial<RouteConfig> = {}) {
  const { createCronRoute } = await import('./withCron');

  return createCronRoute({
    name: 'test-job',
    description: 'Test job',
    run: async () => ({ processed: 3 }),
    ...overrides,
  });
}

function request(method: 'GET' | 'POST', headers: Record<string, string> = {}, query = '') {
  return new Request(`https://example.com/api/cron/test-job${query}`, { method, headers });
}

function authorized(method: 'GET' | 'POST', query = '') {
  return request(method, { 'x-cron-secret': SECRET }, query);
}

describe('createCronRoute', () => {
  beforeEach(() => {
    envMock.CRON_SECRET = SECRET;
    acquireCronLeaseMock.mockClear();
    releaseMock.mockClear();
  });

  it('returns 503 when CRON_SECRET is not configured', async () => {
    envMock.CRON_SECRET = undefined;
    const { POST } = await buildRoute();

    const response = await POST(authorized('POST'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ configured: false });
    expect(acquireCronLeaseMock).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong secret of the same length', async () => {
    const { POST } = await buildRoute();

    const response = await POST(request('POST', { 'x-cron-secret': 'super-secret-valuX' }));

    expect(response.status).toBe(401);
    expect(acquireCronLeaseMock).not.toHaveBeenCalled();
  });

  it('returns 401 for a secret of a different length', async () => {
    const { POST } = await buildRoute();

    const response = await POST(request('POST', { 'x-cron-secret': 'short' }));

    expect(response.status).toBe(401);
    expect(acquireCronLeaseMock).not.toHaveBeenCalled();
  });

  it('runs the job when the secret is provided via x-cron-secret', async () => {
    const run = vi.fn(async () => ({ processed: 3 }));
    const { POST } = await buildRoute({ run });

    const response = await POST(authorized('POST'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, job: 'test-job', runId: 'run-1', processed: 3 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('runs the job when the secret is provided via an Authorization bearer token', async () => {
    const run = vi.fn(async () => ({ processed: 3 }));
    const { POST } = await buildRoute({ run });

    const response = await POST(request('POST', { authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('skips the job when it is disabled', async () => {
    const run = vi.fn(async () => ({ processed: 3 }));
    const { POST } = await buildRoute({ enabled: false, run });

    const response = await POST(authorized('POST'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, skipped: true, reason: 'disabled' });
    expect(run).not.toHaveBeenCalled();
    expect(acquireCronLeaseMock).not.toHaveBeenCalled();
  });

  it('treats GET as a health check by default', async () => {
    const run = vi.fn(async () => ({ processed: 3 }));
    const { GET } = await buildRoute({ run });

    const response = await GET(authorized('GET'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, job: 'test-job', configured: true, enabled: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the job on GET when ?run=1 is passed', async () => {
    const run = vi.fn(async () => ({ processed: 3 }));
    const { GET } = await buildRoute({ run });

    const response = await GET(authorized('GET', '?run=1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, processed: 3 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs the job on a plain GET when runOnGet is set', async () => {
    const run = vi.fn(async () => ({ processed: 3 }));
    const { GET } = await buildRoute({ runOnGet: true, run });

    const response = await GET(authorized('GET'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, processed: 3 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns 500 and releases the lease when the job throws', async () => {
    const { POST } = await buildRoute({
      run: async () => {
        throw new Error('boom');
      },
    });

    const response = await POST(authorized('POST'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ok: false, job: 'test-job', message: 'boom' });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
