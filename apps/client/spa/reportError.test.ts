import { describe, expect, it, vi } from 'vitest';

import { reportError } from './reportError';

const captureException = vi.hoisted(() => vi.fn());
vi.mock('@sentry/react', () => ({ captureException }));

describe('reportError', () => {
  it('hands the error to Sentry once its chunk has loaded', async () => {
    const boom = new Error('boom');
    await reportError(boom);

    expect(captureException).toHaveBeenCalledWith(boom);
  });
});
