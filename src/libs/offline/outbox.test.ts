import type { OutboxItem } from './outboxStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setOutboxStoreForTests,
  classifyResponse,
  flushOutbox,
  listOutbox,
  MAX_RETRY_ATTEMPTS,
  removeOutboxItem,
  REPLAY_ATTEMPT_TIMEOUT_MS,
  retryOutboxItem,
  sendOrQueue,
  setOutboxUser,
  subscribeOutbox,
} from './outbox';
import { createMemoryOutboxStore } from './outboxStore';

function item(overrides: Partial<OutboxItem>): OutboxItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    userId: 'user_a',
    kind: 'attack',
    label: null,
    url: '/api/quick-add/episode',
    method: 'POST',
    body: '{}',
    createdAt: 1,
    attempts: 0,
    status: 'pending',
    lastError: null,
    ...overrides,
  };
}

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let store = createMemoryOutboxStore();

beforeEach(() => {
  store = createMemoryOutboxStore();
  __setOutboxStoreForTests(store);
  setOutboxUser('user_a');
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('classifyResponse', () => {
  it.each([
    [201, undefined, 'done'],
    [401, undefined, 'auth'],
    [409, 'OFFLINE_USER_MISMATCH', 'wrong_user'],
    [409, 'IDEMPOTENCY_IN_PROGRESS', 'retry'],
    [409, 'ONGOING_EXISTS', 'failed'],
    [429, undefined, 'retry'],
    [503, undefined, 'retry'],
    [400, undefined, 'failed'],
    [403, 'CONSENT_REQUIRED', 'failed'],
  ])('%i %s -> %s', (status, code, expected) => {
    expect(classifyResponse(status, code)).toBe(expected);
  });
});

describe('sendOrQueue', () => {
  it('sends immediately with an idempotency key and the capturing user when online', async () => {
    const fetchMock = vi.fn(async () => json(201, { episodeId: 7 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendOrQueue({ url: '/api/x', method: 'POST', body: { a: 1 }, kind: 'attack' });

    expect(result.queued).toBe(false);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers['Idempotency-Key']).toMatch(/^[\w-]{8,}$/);
    expect(headers['X-Offline-User']).toBe('user_a');
    expect(await listOutbox()).toHaveLength(0);
  });

  it('queues without touching the network when the device is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendOrQueue({ url: '/api/x', method: 'POST', body: { a: 1 }, kind: 'dose', label: 'Ibuprofen' });

    expect(result.queued).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const [queued] = await listOutbox();

    expect(queued).toMatchObject({ userId: 'user_a', kind: 'dose', label: 'Ibuprofen', body: '{"a":1}', status: 'pending' });
    expect(queued!.id).toBe((result as { id: string }).id);
  });

  it('queues when the request fails at the network level', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const result = await sendOrQueue({ url: '/api/x', method: 'PUT', body: {}, kind: 'diary' });

    expect(result.queued).toBe(true);
    expect(await listOutbox()).toHaveLength(1);
  });

  it('does not queue when the caller aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    }));

    await expect(sendOrQueue({ url: '/api/x', method: 'POST', body: {}, kind: 'attack', signal: controller.signal }))
      .rejects
      .toThrow();
    expect(await listOutbox()).toHaveLength(0);
  });

  it('joins the queue while earlier entries are still waiting, to keep capture order', async () => {
    await store.put(item({ id: 'earlier' }));
    const fetchMock = vi.fn(async () => {
      throw new TypeError('still flaky');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendOrQueue({ url: '/api/dose', method: 'POST', body: {}, kind: 'dose' });

    expect(result.queued).toBe(true);
    expect((await listOutbox()).map(i => i.id)).toEqual(['earlier', (result as { id: string }).id]);
  });

  it('does not queue without a known user', async () => {
    setOutboxUser(null);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    await expect(sendOrQueue({ url: '/api/x', method: 'POST', body: {}, kind: 'attack' })).rejects.toThrow('Failed to fetch');
  });
});

describe('flushOutbox', () => {
  it('replays in capture order and removes synced entries', async () => {
    await store.put(item({ id: 'b', createdAt: 2, url: '/api/dose' }));
    await store.put(item({ id: 'a', createdAt: 1, url: '/api/attack' }));
    const fetchMock = vi.fn(async () => json(201));

    const summary = await flushOutbox(fetchMock as unknown as typeof fetch);

    expect(fetchMock.mock.calls.map(c => (c as unknown as [string])[0])).toEqual(['/api/attack', '/api/dose']);

    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

    expect(headers['Idempotency-Key']).toBe('a');
    expect(headers['X-Offline-User']).toBe('user_a');
    expect(summary).toMatchObject({ synced: 2, failed: 0, stoppedBy: null });
    expect(await listOutbox()).toHaveLength(0);
  });

  it('stops at a transient failure so later entries never overtake it', async () => {
    await store.put(item({ id: 'a', createdAt: 1 }));
    await store.put(item({ id: 'b', createdAt: 2 }));
    const fetchMock = vi.fn(async () => json(503, { error: 'busy' }));

    const summary = await flushOutbox(fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ synced: 0, stoppedBy: 'retry', remaining: 2 });

    const [a, b] = await listOutbox();

    expect(a).toMatchObject({ id: 'a', status: 'pending', attempts: 1, lastError: 'busy' });
    expect(b).toMatchObject({ id: 'b', attempts: 0 });
  });

  it('stops when the network is still down', async () => {
    await store.put(item({ id: 'a' }));
    const summary = await flushOutbox((async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch);

    expect(summary.stoppedBy).toBe('network');
    expect((await listOutbox())[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('gives up on a request that hangs so the next flush is not blocked by it', async () => {
    vi.useFakeTimers();
    try {
      await store.put(item({ id: 'a' }));
      let signal: AbortSignal | undefined;
      const hanging = vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise<Response>(() => {});
      });

      const first = flushOutbox(hanging as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(REPLAY_ATTEMPT_TIMEOUT_MS);

      await expect(first).resolves.toMatchObject({ stoppedBy: 'network', remaining: 1 });
      expect(signal?.aborted).toBe(true);
      expect((await listOutbox())[0]).toMatchObject({ status: 'pending', attempts: 0 });

      const second = await flushOutbox((async () => json(201)) as unknown as typeof fetch);

      expect(second).toMatchObject({ synced: 1, stoppedBy: null });
      expect(await listOutbox()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('parks a permanently rejected entry and carries on with the rest', async () => {
    await store.put(item({ id: 'a', createdAt: 1 }));
    await store.put(item({ id: 'b', createdAt: 2 }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(409, { error: 'An attack is already in progress.', code: 'ONGOING_EXISTS' }))
      .mockResolvedValueOnce(json(201));

    const summary = await flushOutbox(fetchMock as unknown as typeof fetch);

    expect(summary).toMatchObject({ synced: 1, failed: 1 });

    const left = await listOutbox();

    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: 'a', status: 'failed', lastError: 'An attack is already in progress.' });
  });

  it('keeps entries untouched when the session has expired', async () => {
    await store.put(item({ id: 'a' }));
    const summary = await flushOutbox((async () => json(401)) as unknown as typeof fetch);

    expect(summary.stoppedBy).toBe('auth');
    expect((await listOutbox())[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('gives up on an entry after repeated transient failures', async () => {
    await store.put(item({ id: 'a', attempts: MAX_RETRY_ATTEMPTS - 1 }));
    const summary = await flushOutbox((async () => json(500)) as unknown as typeof fetch);

    expect(summary.failed).toBe(1);
    expect((await listOutbox())[0]).toMatchObject({ status: 'failed', attempts: MAX_RETRY_ATTEMPTS });
  });

  it('only replays entries captured by the signed-in user', async () => {
    await store.put(item({ id: 'mine', userId: 'user_a' }));
    await store.put(item({ id: 'theirs', userId: 'user_b' }));
    const fetchMock = vi.fn(async () => json(201));

    await flushOutbox(fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await store.all()).map(i => i.id)).toEqual(['theirs']);
  });

  it('skips failed entries until they are retried', async () => {
    await store.put(item({ id: 'a', status: 'failed' }));
    const fetchMock = vi.fn(async () => json(201));

    await flushOutbox(fetchMock as unknown as typeof fetch);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('outbox state and subscriptions', () => {
  it('notifies subscribers when the user becomes known (regression: list read before the provider set the user)', async () => {
    setOutboxUser(null);
    await store.put(item({ id: 'a' }));
    const seen: number[] = [];
    const unsubscribe = subscribeOutbox(async () => {
      seen.push((await listOutbox()).length);
    });

    expect(await listOutbox()).toHaveLength(0);

    setOutboxUser('user_a');
    await vi.waitFor(() => expect(seen).toEqual([1]));
    unsubscribe();
  });

  it('does not notify when the same user is set again', () => {
    const cb = vi.fn();
    const unsubscribe = subscribeOutbox(cb);
    setOutboxUser('user_a');

    expect(cb).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('notifies subscribers when an entry is queued and when it is removed', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const cb = vi.fn();
    const unsubscribe = subscribeOutbox(cb);

    const result = await sendOrQueue({ url: '/api/x', method: 'POST', body: {}, kind: 'attack' });
    await removeOutboxItem((result as { id: string }).id);

    expect(cb).toHaveBeenCalledTimes(2);
    expect(await listOutbox()).toHaveLength(0);

    unsubscribe();
  });

  it('retry puts a failed entry back in line and replays it', async () => {
    await store.put(item({ id: 'a', status: 'failed', attempts: 3, lastError: 'Consent required' }));
    const fetchMock = vi.fn(async () => json(201));
    vi.stubGlobal('fetch', fetchMock);

    await retryOutboxItem('a');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await listOutbox()).toHaveLength(0));
  });

  it('retry of an unknown entry is a no-op', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await retryOutboxItem('missing');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists nothing without a user and never another user\'s entries', async () => {
    await store.put(item({ id: 'mine' }));
    await store.put(item({ id: 'theirs', userId: 'user_b' }));

    expect((await listOutbox()).map(i => i.id)).toEqual(['mine']);
    expect(await listOutbox(null)).toEqual([]);
  });
});

describe('sendOrQueue details', () => {
  it('queues when the live attempt times out (connection that hangs)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }));

    const result = await sendOrQueue({ url: '/api/x', method: 'POST', body: {}, kind: 'dose' });

    expect(result.queued).toBe(true);
  });

  it('rethrows unexpected errors instead of hiding them in the queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('boom');
    }));

    await expect(sendOrQueue({ url: '/api/x', method: 'POST', body: {}, kind: 'dose' })).rejects.toThrow('boom');
    expect(await listOutbox()).toHaveLength(0);
  });

  it('returns HTTP errors to the caller rather than queueing them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: 'bad' })));

    const result = await sendOrQueue({ url: '/api/x', method: 'POST', body: {}, kind: 'dose' });

    expect(result.queued).toBe(false);
    expect((result as { response: Response }).response.status).toBe(400);
    expect(await listOutbox()).toHaveLength(0);
  });

  it('asks the service worker for a Background Sync when it queues', async () => {
    const register = vi.fn(async () => {});
    vi.stubGlobal('navigator', {
      onLine: false,
      serviceWorker: { ready: Promise.resolve({ sync: { register } }) },
    });

    await sendOrQueue({ url: '/api/x', method: 'POST', body: {}, kind: 'attack' });

    await vi.waitFor(() => expect(register).toHaveBeenCalledWith('mc-outbox-sync'));
  });

  it('works where Background Sync is not supported (Safari, Firefox)', async () => {
    vi.stubGlobal('navigator', { onLine: false, serviceWorker: { ready: Promise.resolve({}) } });

    const result = await sendOrQueue({ url: '/api/x', method: 'POST', body: {}, kind: 'attack' });

    expect(result.queued).toBe(true);
  });

  it('sends without the user header when no user is known', async () => {
    setOutboxUser(null);
    const fetchMock = vi.fn(async () => json(201));
    vi.stubGlobal('fetch', fetchMock);

    await sendOrQueue({ url: '/api/x', method: 'POST', body: {}, kind: 'attack' });

    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

    expect(headers['X-Offline-User']).toBeUndefined();
    expect(headers['Idempotency-Key']).toBeDefined();
  });

  it('flushes right away when it joined a queue while online', async () => {
    await store.put(item({ id: 'earlier', createdAt: 1 }));
    const fetchMock = vi.fn(async () => json(201));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendOrQueue({ url: '/api/later', method: 'POST', body: {}, kind: 'dose' });

    expect(result.queued).toBe(true);

    await vi.waitFor(async () => expect(await listOutbox()).toHaveLength(0));

    expect(fetchMock.mock.calls.map(c => (c as unknown as [string])[0])).toEqual(['/api/quick-add/episode', '/api/later']);
  });
});

describe('flushOutbox details', () => {
  it('stops for another account and keeps the entry', async () => {
    await store.put(item({ id: 'a' }));
    const summary = await flushOutbox((async () => json(409, { code: 'OFFLINE_USER_MISMATCH' })) as unknown as typeof fetch);

    expect(summary.stoppedBy).toBe('wrong_user');
    expect((await listOutbox())[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('treats a duplicate still in flight as transient', async () => {
    await store.put(item({ id: 'a' }));
    const summary = await flushOutbox((async () => json(409, { code: 'IDEMPOTENCY_IN_PROGRESS' })) as unknown as typeof fetch);

    expect(summary.stoppedBy).toBe('retry');
    expect((await listOutbox())[0]).toMatchObject({ status: 'pending', attempts: 1 });
  });

  it('shares one run between concurrent calls', async () => {
    await store.put(item({ id: 'a' }));
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return json(201);
    });

    const first = flushOutbox(fetchMock as unknown as typeof fetch);
    const second = flushOutbox(fetchMock as unknown as typeof fetch);
    release();

    expect(await first).toBe(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runs again when asked during a run that the network cut short', async () => {
    await store.put(item({ id: 'a' }));
    let failFirst!: () => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((_, reject) => {
        failFirst = () => reject(new TypeError('offline'));
      }))
      .mockResolvedValueOnce(json(201));

    const first = flushOutbox(fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Connection comes back while the first attempt is still pending.
    void flushOutbox(fetchMock as unknown as typeof fetch);
    failFirst();

    await expect(first).resolves.toMatchObject({ stoppedBy: 'network' });

    await vi.waitFor(async () => expect(await listOutbox()).toHaveLength(0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not run again after a server-side stop, so a 503 cannot loop', async () => {
    await store.put(item({ id: 'a' }));
    const fetchMock = vi.fn(async () => json(503, { error: 'busy' }));

    const first = flushOutbox(fetchMock as unknown as typeof fetch);
    void flushOutbox(fetchMock as unknown as typeof fetch);
    await first;
    await new Promise(r => setTimeout(r, 10));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses a Web Lock when the browser has one', async () => {
    const request = vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn());
    vi.stubGlobal('navigator', { onLine: true, locks: { request } });
    await store.put(item({ id: 'a' }));

    await flushOutbox((async () => json(201)) as unknown as typeof fetch);

    expect(request).toHaveBeenCalledWith('mc-outbox', expect.any(Function));
  });

  it('does nothing without a user', async () => {
    setOutboxUser(null);
    await store.put(item({ id: 'a' }));
    const fetchMock = vi.fn();

    const summary = await flushOutbox(fetchMock as unknown as typeof fetch);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary.synced).toBe(0);
  });
});
