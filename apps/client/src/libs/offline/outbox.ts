import type { OutboxItem, OutboxKind, OutboxStore } from './outboxStore';
import { createMemoryOutboxStore, indexedDbOutboxStore } from './outboxStore';

/**
 * Offline outbox: writes for attacks, doses and diary entries that could not
 * reach the server are kept on the device and replayed in order later.
 *
 * - Every write carries an Idempotency-Key, so a replay never duplicates an
 *   entry even when the first attempt did reach the server.
 * - Replays run strictly in capture order and stop at the first transient
 *   failure, so a dose logged during an attack is never sent before the
 *   attack itself.
 * - Payloads carry the time captured on the device (startedAt, takenAt,
 *   endedAt), never "now" on the server.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const OFFLINE_USER_HEADER = 'X-Offline-User';
export const OUTBOX_CHANNEL = 'mc-outbox';
export const OUTBOX_SYNC_TAG = 'mc-outbox-sync';
/** Transient failures before an entry is moved to "needs attention". */
export const MAX_RETRY_ATTEMPTS = 8;
/** How long a live attempt may hang before the entry is queued instead. */
export const LIVE_ATTEMPT_TIMEOUT_MS = 15_000;
/**
 * Upper bound for one replayed request. Without it, a request that hangs
 * instead of failing (a captive portal, a stalled connection, or offline
 * emulation in some browsers) keeps the shared flush and its Web Lock busy,
 * and every later flush, including the one on `online`, waits on it forever.
 */
export const REPLAY_ATTEMPT_TIMEOUT_MS = 15_000;

type Outcome = 'done' | 'retry' | 'auth' | 'failed' | 'wrong_user';

/** Decide what to do with a replay response. */
export function classifyResponse(status: number, code?: string | null): Outcome {
  if (status >= 200 && status < 300) {
    return 'done';
  }
  if (status === 401) {
    return 'auth';
  }
  if (status === 409 && code === 'OFFLINE_USER_MISMATCH') {
    return 'wrong_user';
  }
  if (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS') {
    return 'retry';
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return 'retry';
  }
  return 'failed';
}

// ---------------------------------------------------------------------------
// Module state (one per tab)

let store: OutboxStore = typeof indexedDB === 'undefined' ? createMemoryOutboxStore() : indexedDbOutboxStore;
let currentUserId: string | null = null;
const localEvents = typeof EventTarget === 'undefined' ? null : new EventTarget();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(OUTBOX_CHANNEL);
    // Node (tests/SSR) keeps the process alive for an open channel.
    (channel as BroadcastChannel & { unref?: () => void }).unref?.();
  }
  return channel;
}

/** Test hook. */
export function __setOutboxStoreForTests(next: OutboxStore) {
  store = next;
}

export function setOutboxUser(userId: string | null) {
  if (currentUserId === userId) {
    return;
  }
  currentUserId = userId;
  // Subscribers that mounted before the user was known (child effects run
  // before the provider's) need to re-read the list.
  localEvents?.dispatchEvent(new Event('change'));
}

export function getOutboxUser(): string | null {
  return currentUserId;
}

function notifyChanged() {
  localEvents?.dispatchEvent(new Event('change'));
  try {
    getChannel()?.postMessage({ type: 'changed' });
  } catch {
    // ignore
  }
}

/** Subscribe to outbox changes from this tab, other tabs and the service worker. */
export function subscribeOutbox(cb: () => void): () => void {
  const onLocal = () => cb();
  localEvents?.addEventListener('change', onLocal);
  const ch = getChannel();
  const onMessage = () => cb();
  ch?.addEventListener('message', onMessage);
  return () => {
    localEvents?.removeEventListener('change', onLocal);
    ch?.removeEventListener('message', onMessage);
  };
}

export async function listOutbox(userId: string | null = currentUserId): Promise<OutboxItem[]> {
  if (!userId) {
    return [];
  }
  try {
    return (await store.all()).filter(i => i.userId === userId);
  } catch {
    return [];
  }
}

export async function removeOutboxItem(id: string) {
  await store.delete(id);
  notifyChanged();
}

/** Put a failed entry back in line, e.g. after the user granted consent. */
export async function retryOutboxItem(id: string) {
  const item = (await store.all()).find(i => i.id === id);
  if (!item) {
    return;
  }
  await store.put({ ...item, status: 'pending', attempts: 0, lastError: null });
  notifyChanged();
  void flushOutbox();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function requestBackgroundSync() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  navigator.serviceWorker.ready
    .then(reg => (reg as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } })
      .sync
      ?.register(OUTBOX_SYNC_TAG))
    .catch(() => {});
}

function isNetworkError(e: unknown): boolean {
  if (!e || typeof e !== 'object') {
    return false;
  }
  const name = (e as { name?: string }).name;
  // fetch rejects with TypeError on network failure; TimeoutError comes from AbortSignal.timeout.
  return name === 'TypeError' || name === 'TimeoutError';
}

export type SendResult
  = | { queued: false; response: Response }
    | { queued: true; id: string };

/**
 * Send a write now if possible; otherwise keep it on the device and sync it
 * later. Callers must put the device-captured time into `body` themselves.
 *
 * An AbortError from the caller's own signal is rethrown, not queued.
 */
export async function sendOrQueue(req: {
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  body: unknown;
  kind: OutboxKind;
  label?: string | null;
  signal?: AbortSignal;
}): Promise<SendResult> {
  const id = newId();
  const body = JSON.stringify(req.body ?? {});
  const userId = currentUserId;

  const enqueue = async (): Promise<SendResult> => {
    await store.put({
      id,
      userId: userId!,
      kind: req.kind,
      label: req.label ?? null,
      url: req.url,
      method: req.method,
      body,
      createdAt: Date.now(),
      attempts: 0,
      status: 'pending',
      lastError: null,
    });
    notifyChanged();
    requestBackgroundSync();
    return { queued: true, id };
  };

  if (userId) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    // Keep capture order: while earlier entries are still waiting, new ones
    // join the line instead of overtaking them.
    const waiting = (await listOutbox(userId)).some(i => i.status === 'pending');
    if (offline || waiting) {
      const result = await enqueue();
      if (!offline) {
        void flushOutbox();
      }
      return result;
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: id };
  if (userId) {
    headers[OFFLINE_USER_HEADER] = userId;
  }

  const timeout = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(LIVE_ATTEMPT_TIMEOUT_MS)
    : undefined;
  const signal = req.signal && timeout && 'any' in AbortSignal
    ? AbortSignal.any([req.signal, timeout])
    : (req.signal ?? timeout);

  try {
    const response = await fetch(req.url, { method: req.method, headers, body, signal });
    return { queued: false, response };
  } catch (e) {
    if (req.signal?.aborted) {
      throw e;
    }
    if (userId && isNetworkError(e)) {
      // The request may or may not have reached the server. The replay
      // reuses the same Idempotency-Key, so either way it is saved once.
      return enqueue();
    }
    throw e;
  }
}

export type FlushSummary = { synced: number; failed: number; remaining: number; stoppedBy: Outcome | 'network' | null };

let flushing: Promise<FlushSummary> | null = null;
let flushRequestedDuringRun = false;

/** fetch that settles within `ms` even if the implementation ignores abort. */
function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TypeError('Replay request timed out'));
    }, ms);
  });
  return Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), timeout])
    .finally(() => clearTimeout(timer));
}

/**
 * Replay this user's pending entries in capture order. Safe to call often;
 * concurrent calls in one tab share a run, and across tabs and the service
 * worker a Web Lock keeps one replay at a time where supported.
 */
export function flushOutbox(fetchImpl: typeof fetch = fetch): Promise<FlushSummary> {
  if (flushing) {
    // Joining a run that may already be doomed, e.g. `online` firing while a
    // request sent during the outage is still timing out: try again after it.
    flushRequestedDuringRun = true;
    return flushing;
  }
  flushRequestedDuringRun = false;
  const run = runWithLock(() => flushOnce(fetchImpl));
  flushing = run.finally(() => {
    flushing = null;
  });
  void run.then((summary) => {
    if (flushRequestedDuringRun && summary.stoppedBy === 'network') {
      flushRequestedDuringRun = false;
      void flushOutbox(fetchImpl);
    }
  }, () => {});
  return flushing;
}

async function runWithLock(fn: () => Promise<FlushSummary>): Promise<FlushSummary> {
  const locks = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: LockManager }).locks
    : undefined;
  if (!locks) {
    return fn();
  }
  return locks.request(OUTBOX_CHANNEL, fn) as Promise<FlushSummary>;
}

async function flushOnce(fetchImpl: typeof fetch): Promise<FlushSummary> {
  const summary: FlushSummary = { synced: 0, failed: 0, remaining: 0, stoppedBy: null };
  const userId = currentUserId;
  if (!userId) {
    return summary;
  }

  const items = (await listOutbox(userId)).filter(i => i.status === 'pending');
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]!;
    let outcome: Outcome;
    let errorText: string | null = null;
    try {
      const res = await fetchWithTimeout(fetchImpl, item.url, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
          [IDEMPOTENCY_HEADER]: item.id,
          [OFFLINE_USER_HEADER]: item.userId,
        },
        body: item.body,
      }, REPLAY_ATTEMPT_TIMEOUT_MS);
      const data = res.ok ? null : await res.json().catch(() => null);
      outcome = classifyResponse(res.status, data?.code);
      errorText = data?.error ?? (res.ok ? null : `HTTP ${res.status}`);
    } catch {
      summary.stoppedBy = 'network';
      summary.remaining = items.length - idx;
      break;
    }

    if (outcome === 'done') {
      await store.delete(item.id);
      summary.synced++;
      continue;
    }

    if (outcome === 'failed') {
      await store.put({ ...item, status: 'failed', attempts: item.attempts + 1, lastError: errorText });
      summary.failed++;
      continue;
    }

    if (outcome === 'retry') {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        await store.put({ ...item, status: 'failed', attempts, lastError: errorText });
        summary.failed++;
        continue;
      }
      await store.put({ ...item, attempts, lastError: errorText });
    }

    // retry / auth / wrong_user: stop here to keep the order intact.
    summary.stoppedBy = outcome;
    summary.remaining = items.length - idx;
    break;
  }

  if (summary.synced > 0 || summary.failed > 0) {
    notifyChanged();
  }
  return summary;
}
