import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Runs the real public/sw.js inside a VM sandbox with in-memory fakes for
 * IndexedDB, Cache Storage, fetch and BroadcastChannel, then drives its
 * event handlers the way the browser would.
 */

const SW_SOURCE = readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8');
const ORIGIN = 'https://app.test';

// ---------------------------------------------------------------------------
// Fakes

type Row = Record<string, any> & { id: string };

function createFakeIndexedDb(rows: Map<string, Row>) {
  function request<T>(compute: () => T) {
    const req: any = { onsuccess: null, onerror: null, result: undefined, error: null };
    queueMicrotask(() => {
      try {
        req.result = compute();
        req.onsuccess?.();
      } catch (e) {
        req.error = e;
        req.onerror?.();
      }
    });
    return req;
  }

  let created = false;
  const db = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => {
      created = true;
    },
    close: () => {},
    transaction: () => {
      const tx: any = { oncomplete: null, onerror: null };
      const store = {
        getAll: () => request(() => [...rows.values()].map(r => structuredClone(r))),
        put: (value: Row) => request(() => {
          rows.set(value.id, structuredClone(value));
          return value.id;
        }),
        delete: (id: string) => request(() => {
          rows.delete(id);
        }),
      };
      // Complete after the request callbacks have run.
      setTimeout(() => tx.oncomplete?.(), 0);
      tx.objectStore = () => store;
      return tx;
    },
  };

  return {
    open: () => {
      const req: any = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (!created) {
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function keyOf(input: string | Request): string {
  const url = typeof input === 'string' ? input : input.url;
  return new URL(url, ORIGIN).toString();
}

function createFakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) {
      stores.set(name, new Map());
    }
    const m = stores.get(name)!;
    return {
      match: async (req: string | Request) => m.get(keyOf(req))?.clone(),
      put: async (req: string | Request, res: Response) => {
        m.set(keyOf(req), res);
      },
      addAll: async (urls: string[]) => {
        for (const u of urls) {
          m.set(keyOf(u), new Response(`asset ${u}`));
        }
      },
      keys: async () => [...m.keys()].map(u => new Request(u)),
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (req: string | Request) => {
        for (const m of stores.values()) {
          const hit = m.get(keyOf(req));
          if (hit) {
            return hit.clone();
          }
        }
        return undefined;
      },
    },
  };
}

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function outboxRow(overrides: Partial<Row>): Row {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    userId: 'user_a',
    kind: 'attack',
    label: null,
    url: '/api/quick-add/episode',
    method: 'POST',
    body: '{"attackType":"migraine"}',
    createdAt: 1,
    attempts: 0,
    status: 'pending',
    lastError: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness

function loadSw(opts: { rows?: Row[] } = {}) {
  const rows = new Map((opts.rows ?? []).map(r => [r.id, r]));
  const caches = createFakeCaches();
  const listeners = new Map<string, (event: any) => void>();
  const fetchMock = vi.fn<(input: any, init?: any) => Promise<Response>>();
  const broadcasts: unknown[] = [];

  class FakeBroadcastChannel {
    postMessage(msg: unknown) {
      broadcasts.push(msg);
    }

    close() {}
  }

  const self: any = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, fn: (event: any) => void) => listeners.set(type, fn),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []) },
    registration: { showNotification: vi.fn() },
    navigator: {},
  };

  const sandbox: any = {
    self,
    caches: caches.api,
    indexedDB: createFakeIndexedDb(rows),
    fetch: fetchMock,
    BroadcastChannel: FakeBroadcastChannel,
    Response,
    Request,
    URL,
    console: { log: () => {}, error: () => {} },
    clients: self.clients,
    setTimeout,
    clearTimeout,
    AbortController,
    queueMicrotask,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox);

  async function dispatch(type: string, event: any) {
    let pending: Promise<unknown> | undefined;
    let responded: Promise<Response> | undefined;
    const fn = listeners.get(type);
    if (!fn) {
      throw new Error(`no ${type} listener`);
    }
    fn({
      ...event,
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
    });
    return { pending, responded };
  }

  async function fetchEvent(url: string, init: { method?: string; mode?: string } = {}) {
    const request = new Request(new URL(url, ORIGIN), { method: init.method ?? 'GET' });
    Object.defineProperty(request, 'mode', { value: init.mode ?? 'cors' });
    const { responded } = await dispatch('fetch', { request });
    return responded;
  }

  async function sync(tag = 'mc-outbox-sync') {
    const { pending } = await dispatch('sync', { tag });
    return pending;
  }

  return { rows, caches, fetchMock, broadcasts, dispatch, fetchEvent, sync, self };
}

// ---------------------------------------------------------------------------

describe('service worker: outbox replay (Background Sync)', () => {
  let sw: ReturnType<typeof loadSw>;

  beforeEach(() => {
    sw = loadSw({
      rows: [
        outboxRow({ id: 'b', createdAt: 2, url: '/api/quick-add/medication-intake', kind: 'dose' }),
        outboxRow({ id: 'a', createdAt: 1 }),
      ],
    });
  });

  it('ignores other sync tags', async () => {
    expect(await sw.sync('something-else')).toBeUndefined();
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it('replays in capture order with the idempotency key and capturing user, then clears the queue', async () => {
    sw.fetchMock.mockResolvedValue(json(201));

    await sw.sync();

    expect(sw.fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/quick-add/episode', '/api/quick-add/medication-intake']);

    const init = sw.fetchMock.mock.calls[0]![1];

    expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: '{"attackType":"migraine"}' });
    expect(init.headers).toMatchObject({ 'Idempotency-Key': 'a', 'X-Offline-User': 'user_a' });
    expect(sw.rows.size).toBe(0);
    expect(sw.broadcasts).toEqual([{ type: 'changed' }]);
  });

  it('stops at a transient failure, keeps order, and asks the browser to retry later', async () => {
    sw.fetchMock.mockResolvedValue(json(503, { error: 'busy' }));

    await expect(sw.sync()).rejects.toThrow('Outbox not fully synced');

    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
    expect(sw.rows.get('a')).toMatchObject({ status: 'pending', attempts: 1, lastError: 'busy' });
    expect(sw.rows.get('b')).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('stops without touching entries while the network is down', async () => {
    sw.fetchMock.mockRejectedValue(new TypeError('offline'));

    await expect(sw.sync()).rejects.toThrow();

    expect(sw.rows.get('a')).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('gives up on a request that hangs so the lock is released and the browser retries', async () => {
    vi.useFakeTimers();
    try {
      // Load after faking timers so the worker's setTimeout is the fake one.
      sw = loadSw({ rows: [outboxRow({ id: 'a' })] });
      sw.fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

      const run = sw.sync()!;
      const settled = expect(run).rejects.toThrow('Outbox not fully synced');
      await vi.advanceTimersByTimeAsync(15_000);
      await settled;

      expect(sw.fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
      expect(sw.rows.get('a')).toMatchObject({ status: 'pending', attempts: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('parks a rejected entry and continues with the next one', async () => {
    sw.fetchMock
      .mockResolvedValueOnce(json(409, { error: 'An attack is already in progress.', code: 'ONGOING_EXISTS' }))
      .mockResolvedValueOnce(json(201));

    await sw.sync();

    expect(sw.rows.get('a')).toMatchObject({ status: 'failed', attempts: 1, lastError: 'An attack is already in progress.' });
    expect(sw.rows.has('b')).toBe(false);
  });

  it('marks an entry failed after the maximum number of transient failures', async () => {
    sw.rows.set('a', outboxRow({ id: 'a', createdAt: 1, attempts: 7 }));
    sw.fetchMock.mockResolvedValueOnce(json(500)).mockResolvedValueOnce(json(201));

    await sw.sync();

    expect(sw.rows.get('a')).toMatchObject({ status: 'failed', attempts: 8, lastError: 'HTTP 500' });
    expect(sw.rows.has('b')).toBe(false);
  });

  it('skips entries already marked failed', async () => {
    sw.rows.set('a', outboxRow({ id: 'a', createdAt: 1, status: 'failed' }));
    sw.fetchMock.mockResolvedValue(json(201));

    await sw.sync();

    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
    expect(sw.rows.get('a')).toMatchObject({ status: 'failed' });
  });

  it('holds back only the affected user when the session belongs to someone else', async () => {
    sw = loadSw({
      rows: [
        outboxRow({ id: 'a1', userId: 'user_a', createdAt: 1 }),
        outboxRow({ id: 'b1', userId: 'user_b', createdAt: 2 }),
        outboxRow({ id: 'a2', userId: 'user_a', createdAt: 3 }),
      ],
    });
    sw.fetchMock.mockImplementation(async (_url, init) =>
      init.headers['X-Offline-User'] === 'user_a'
        ? json(409, { code: 'OFFLINE_USER_MISMATCH' })
        : json(201));

    await expect(sw.sync()).rejects.toThrow();

    // a1 tried once, a2 never sent ahead of it, b1 synced.
    expect(sw.fetchMock.mock.calls.map(c => c[1].headers['Idempotency-Key'])).toEqual(['a1', 'b1']);
    expect([...sw.rows.keys()].sort()).toEqual(['a1', 'a2']);
    expect(sw.rows.get('a1')).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('keeps everything when the session has expired', async () => {
    sw.fetchMock.mockResolvedValue(json(401));

    await expect(sw.sync()).rejects.toThrow();

    expect(sw.rows.get('a')).toMatchObject({ status: 'pending', attempts: 0 });
    expect(sw.rows.get('b')).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('serialises replays through a Web Lock when available', async () => {
    const request = vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn());
    sw.self.navigator.locks = { request };
    sw.fetchMock.mockResolvedValue(json(201));

    await sw.sync();

    expect(request).toHaveBeenCalledWith('mc-outbox', expect.any(Function));
    expect(sw.rows.size).toBe(0);
  });
});

describe('service worker: caching', () => {
  it('never intercepts writes', async () => {
    const sw = loadSw();

    expect(await sw.fetchEvent('/api/quick-add/episode', { method: 'POST' })).toBeUndefined();
    expect(await sw.fetchEvent('/api/diary/entry', { method: 'PUT' })).toBeUndefined();
  });

  it('leaves cross-origin, auth and uncached API requests alone', async () => {
    const sw = loadSw();

    expect(await sw.fetchEvent('https://clerk.example.com/v1/client')).toBeUndefined();
    expect(await sw.fetchEvent('/api/insights')).toBeUndefined();
    expect(await sw.fetchEvent('/sign-in', { mode: 'navigate' })).toBeUndefined();
    expect(await sw.fetchEvent('/', { mode: 'navigate' })).toBeUndefined();
  });

  it('serves hashed build assets cache-first', async () => {
    const sw = loadSw();
    sw.fetchMock.mockResolvedValue(new Response('chunk-v1'));

    const first = await sw.fetchEvent('/_next/static/chunks/app.js');
    sw.fetchMock.mockRejectedValue(new TypeError('offline'));
    const second = await sw.fetchEvent('/_next/static/chunks/app.js');

    expect(await first!.text()).toBe('chunk-v1');
    expect(await second!.text()).toBe('chunk-v1');
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches dashboard pages network-first and serves them offline', async () => {
    const sw = loadSw();
    sw.fetchMock.mockResolvedValue(new Response('<html>diary v1</html>'));

    await sw.fetchEvent('/fr/dashboard/diary', { mode: 'navigate' });
    sw.fetchMock.mockResolvedValue(new Response('<html>diary v2</html>'));
    const fresh = await sw.fetchEvent('/fr/dashboard/diary', { mode: 'navigate' });
    sw.fetchMock.mockRejectedValue(new TypeError('offline'));
    const offline = await sw.fetchEvent('/fr/dashboard/diary', { mode: 'navigate' });

    expect(await fresh!.text()).toBe('<html>diary v2</html>');
    expect(await offline!.text()).toBe('<html>diary v2</html>');
  });

  it('caches attack mode network-first so it opens offline, but not other quick pages', async () => {
    const sw = loadSw();
    sw.fetchMock.mockResolvedValue(new Response('<html>attack mode</html>'));

    await sw.fetchEvent('/uk/quick/attack', { mode: 'navigate' });
    const sleep = await sw.fetchEvent('/quick/sleep', { mode: 'navigate' });
    sw.fetchMock.mockRejectedValue(new TypeError('offline'));
    const offline = await sw.fetchEvent('/uk/quick/attack', { mode: 'navigate' });

    expect(await offline!.text()).toBe('<html>attack mode</html>');
    // Not intercepted: the browser handles it directly.
    expect(sleep).toBeUndefined();
  });

  it('falls back to the dashboard home in the same locale for an unvisited page', async () => {
    const sw = loadSw();
    sw.fetchMock.mockResolvedValue(new Response('<html>uk home</html>'));
    await sw.fetchEvent('/uk/dashboard', { mode: 'navigate' });
    sw.fetchMock.mockRejectedValue(new TypeError('offline'));

    const res = await sw.fetchEvent('/uk/dashboard/insights', { mode: 'navigate' });

    expect(await res!.text()).toBe('<html>uk home</html>');
  });

  it('shows an offline page when nothing was cached yet', async () => {
    const sw = loadSw();
    sw.fetchMock.mockRejectedValue(new TypeError('offline'));

    const res = await sw.fetchEvent('/dashboard', { mode: 'navigate' });

    expect(res!.status).toBe(503);
    expect(await res!.text()).toContain('You\'re offline');
  });

  it('does not cache redirects or errors', async () => {
    const sw = loadSw();
    const redirected = new Response('<html>sign in</html>');
    Object.defineProperty(redirected, 'redirected', { value: true });
    sw.fetchMock.mockResolvedValueOnce(redirected).mockResolvedValueOnce(new Response('oops', { status: 500 }));

    await sw.fetchEvent('/dashboard', { mode: 'navigate' });
    await sw.fetchEvent('/dashboard/diary', { mode: 'navigate' });

    expect(sw.caches.stores.get('migrennity-user-pages')?.size ?? 0).toBe(0);
  });

  it('caches the allowlisted read APIs network-first', async () => {
    const sw = loadSw();
    sw.fetchMock.mockResolvedValue(json(200, { consents: { health_data: true } }));
    await sw.fetchEvent('/api/user/consent');
    sw.fetchMock.mockRejectedValue(new TypeError('offline'));

    const res = await sw.fetchEvent('/api/user/consent');

    expect(await res!.json()).toEqual({ consents: { health_data: true } });
  });

  it('propagates the network error for an allowlisted API that was never cached', async () => {
    const sw = loadSw();
    sw.fetchMock.mockRejectedValue(new TypeError('offline'));

    await expect(sw.fetchEvent('/api/diary/today')).rejects.toThrow('offline');
  });

  it('wipes cached user data on CLEAR_USER_DATA but keeps build assets', async () => {
    const sw = loadSw();
    sw.fetchMock.mockResolvedValue(new Response('x'));
    await sw.fetchEvent('/dashboard', { mode: 'navigate' });
    await sw.fetchEvent('/api/diary/today');
    await sw.fetchEvent('/_next/static/chunks/app.js');

    const { pending } = await sw.dispatch('message', { data: { type: 'CLEAR_USER_DATA' } });
    await pending;

    expect([...sw.caches.stores.keys()]).toEqual(['migrennity-next-static']);
  });

  it('removes caches from older versions on activate', async () => {
    const sw = loadSw();
    await sw.caches.api.open('migrennity-sw-v1.0.0');
    await sw.caches.api.open('migrennity-next-static');
    await sw.caches.api.open('unrelated-cache');

    const { pending } = await sw.dispatch('activate', {});
    await pending;

    expect([...sw.caches.stores.keys()].sort()).toEqual(['migrennity-next-static', 'unrelated-cache']);
  });
});
