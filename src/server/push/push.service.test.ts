import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

const deletes: { where: unknown }[] = [];

vi.mock('@/libs/DB', () => ({
  db: {
    delete: vi.fn(() => ({
      where: vi.fn((where: unknown) => {
        deletes.push({ where });
        return { returning: vi.fn(async () => [{ id: 's1', userId: 'u1' }]) };
      }),
    })),
  },
}));

vi.mock('web-push', () => ({ sendNotification: vi.fn(), setVapidDetails: vi.fn() }));

describe('PushService.unsubscribe', () => {
  it('only deletes the caller\'s own subscription for the endpoint', async () => {
    const { pushService } = await import('./push.service');
    const count = await pushService.unsubscribe('u1', 'https://push.example/x');

    expect(count).toBe(1);

    const query = new PgDialect().sqlToQuery(deletes[0]!.where as any);

    expect(query.sql).toBe('("push_subscription"."endpoint" = $1 and "push_subscription"."user_id" = $2)');
    expect(query.params).toEqual(['https://push.example/x', 'u1']);
  });
});
