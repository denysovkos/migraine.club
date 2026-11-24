/**
 * IndexedDB storage for the offline outbox.
 *
 * The same database is read by the service worker (public/sw.js) to replay
 * entries via Background Sync while the app is closed. Keep OUTBOX_DB,
 * OUTBOX_STORE and the item shape in sync with that file.
 */

export const OUTBOX_DB = 'mc-offline';
export const OUTBOX_DB_VERSION = 1;
export const OUTBOX_STORE = 'outbox';

export type OutboxKind = 'attack' | 'attack_update' | 'dose' | 'diary' | 'factor' | 'relief';

export type OutboxItem = {
  /** Also sent as the Idempotency-Key header. */
  id: string;
  /** Clerk user id signed in when the entry was captured. */
  userId: string;
  kind: OutboxKind;
  /** Short human label for the pending/failed list, e.g. a medication name. */
  label: string | null;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  /** JSON string. */
  body: string;
  createdAt: number;
  attempts: number;
  status: 'pending' | 'failed';
  lastError: string | null;
};

export type OutboxStore = {
  put: (item: OutboxItem) => Promise<void>;
  delete: (id: string) => Promise<void>;
  all: () => Promise<OutboxItem[]>;
  clearUser: (userId: string) => Promise<void>;
};

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(OUTBOX_DB, OUTBOX_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(OUTBOX_STORE, mode);
  const result = await requestToPromise(fn(tx.objectStore(OUTBOX_STORE)));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return result;
}

export const indexedDbOutboxStore: OutboxStore = {
  async put(item) {
    await withStore('readwrite', s => s.put(item));
  },
  async delete(id) {
    await withStore('readwrite', s => s.delete(id));
  },
  async all() {
    const items = await withStore<OutboxItem[]>('readonly', s => s.getAll());
    return items.sort((a, b) => a.createdAt - b.createdAt);
  },
  async clearUser(userId) {
    const items = await this.all();
    await Promise.all(items.filter(i => i.userId === userId).map(i => this.delete(i.id)));
  },
};

/** In-memory store for tests and for browsers without IndexedDB. */
export function createMemoryOutboxStore(initial: OutboxItem[] = []): OutboxStore {
  const map = new Map(initial.map(i => [i.id, { ...i }]));
  return {
    async put(item) {
      map.set(item.id, { ...item });
    },
    async delete(id) {
      map.delete(id);
    },
    async all() {
      return [...map.values()].map(i => ({ ...i })).sort((a, b) => a.createdAt - b.createdAt);
    },
    async clearUser(userId) {
      for (const [id, item] of map) {
        if (item.userId === userId) {
          map.delete(id);
        }
      }
    },
  };
}
