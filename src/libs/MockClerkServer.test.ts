import { beforeEach, describe, expect, it, vi } from 'vitest';

const headersMock = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => headersMock(),
}));

/** What Next throws from headers() while prerendering a page at build time. */
function dynamicServerUsageError(): Error {
  const error = new Error('Route used `headers()`') as Error & { digest: string };
  error.digest = 'DYNAMIC_SERVER_USAGE';
  return error;
}

describe('MockClerkServer.auth', () => {
  beforeEach(() => {
    headersMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('uses the user stamped on the request by the proxy', async () => {
    headersMock.mockResolvedValue(new Headers({ 'x-e2e-mock-user': 'e2e_other' }));
    const { auth } = await import('./MockClerkServer');

    await expect(auth()).resolves.toMatchObject({ userId: 'e2e_other' });
  });

  it('falls back to the configured mock user outside a request', async () => {
    vi.stubEnv('E2E_MOCK_USER_ID', 'e2e_env_user');
    headersMock.mockImplementation(() => {
      throw new Error('headers() was called outside a request scope');
    });
    const { auth } = await import('./MockClerkServer');

    await expect(auth()).resolves.toMatchObject({ userId: 'e2e_env_user' });
  });

  it('lets Next\'s request-time bailout through so signed-in pages are not prerendered', async () => {
    headersMock.mockImplementation(() => {
      throw dynamicServerUsageError();
    });
    const { auth } = await import('./MockClerkServer');

    await expect(auth()).rejects.toMatchObject({ digest: 'DYNAMIC_SERVER_USAGE' });
  });
});
