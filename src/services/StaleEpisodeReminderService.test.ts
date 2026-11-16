import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/push/push.service', () => {
  return {
    pushService: {
      isConfigured: vi.fn(() => true),
      sendToUser: vi.fn(async () => ({ sentCount: 1, removedCount: 0, failedCount: 0, errors: [] })),
    },
  };
});

vi.mock('@/libs/DB', () => {
  let run = 0;

  const returning = vi.fn(async () => {
    run++;
    if (run === 1) {
      return [{ id: 123, userId: 'user_1', startTime: new Date('2024-01-01T00:00:00Z') }];
    }
    return [];
  });

  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));

  // `where` is both awaited directly (user language lookup) and used as a
  // subquery builder (`.limit(...)` inside the bounded claim), so it must be
  // thenable *and* expose `limit`.
  const selectWhere = vi.fn(() => {
    const builder: any = {
      limit: vi.fn(() => builder),
      then: (resolve: (rows: unknown[]) => unknown) =>
        resolve([{ userId: 'user_1', preferredLanguage: 'en' }]),
    };
    return builder;
  });
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));

  return {
    db: {
      update,
      select,
    },
  };
});

describe('StaleEpisodeReminderService', () => {
  it('is idempotent if the DB claim returns no rows on subsequent runs', async () => {
    const { staleEpisodeReminderService } = await import('./StaleEpisodeReminderService');
    const { pushService } = await import('@/server/push/push.service');

    await staleEpisodeReminderService.process(new Date('2024-01-03T00:00:00Z'));
    await staleEpisodeReminderService.process(new Date('2024-01-03T01:00:00Z'));

    expect(pushService.sendToUser).toHaveBeenCalledTimes(1);
  });
});
