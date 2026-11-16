import { beforeEach, describe, expect, it, vi } from 'vitest';

import { skipIntake } from './intakeApi';

describe('skipIntake', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  it('throws when the server responds with a non-ok status', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(skipIntake()).rejects.toThrow();
  });

  it('resolves when the server responds ok', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    await expect(skipIntake()).resolves.toBeUndefined();
  });
});
