import type { OutboxItem } from '@/libs/offline/outboxStore';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setOutboxStoreForTests, getOutboxUser, setOutboxUser } from '@/libs/offline/outbox';
import { createMemoryOutboxStore } from '@/libs/offline/outboxStore';
import { OfflineSyncProvider } from './OfflineSyncProvider';

const authState = { isLoaded: true, userId: 'user_a' as string | null };
vi.mock('@clerk/nextjs', () => ({ useAuth: () => authState }));

// The indicator has its own tests.
vi.mock('./OfflineSyncIndicator', () => ({ OfflineSyncIndicator: () => null }));

const postMessage = vi.fn();

function item(overrides: Partial<OutboxItem>): OutboxItem {
  return {
    id: 'a',
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

let store = createMemoryOutboxStore();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = createMemoryOutboxStore();
  __setOutboxStoreForTests(store);
  setOutboxUser(null);
  localStorage.clear();
  authState.isLoaded = true;
  authState.userId = 'user_a';
  postMessage.mockReset();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ active: { postMessage } }) },
  });
  fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OfflineSyncProvider', () => {
  it('ties the outbox to the signed-in user and remembers them for offline use', async () => {
    render(<OfflineSyncProvider><div /></OfflineSyncProvider>);

    await waitFor(() => expect(getOutboxUser()).toBe('user_a'));

    expect(localStorage.getItem('mc-offline-user')).toBe('user_a');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('replays what is waiting on start', async () => {
    await store.put(item({}));
    render(<OfflineSyncProvider><div /></OfflineSyncProvider>);

    await waitFor(async () => expect(await store.all()).toHaveLength(0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offline (Clerk cannot load) it keeps using the last confirmed user', async () => {
    localStorage.setItem('mc-offline-user', 'user_a');
    authState.isLoaded = false;
    authState.userId = null;

    render(<OfflineSyncProvider><div /></OfflineSyncProvider>);

    await waitFor(() => expect(getOutboxUser()).toBe('user_a'));

    expect(localStorage.getItem('mc-offline-user')).toBe('user_a');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('on an account switch it wipes the previous user\'s cached pages and data', async () => {
    localStorage.setItem('mc-offline-user', 'user_a');
    authState.userId = 'user_b';

    render(<OfflineSyncProvider><div /></OfflineSyncProvider>);

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_USER_DATA' }));

    expect(getOutboxUser()).toBe('user_b');
    expect(localStorage.getItem('mc-offline-user')).toBe('user_b');
  });

  it('on sign-out it wipes cached data and stops tagging entries with the old user', async () => {
    localStorage.setItem('mc-offline-user', 'user_a');
    authState.userId = null;

    render(<OfflineSyncProvider><div /></OfflineSyncProvider>);

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_USER_DATA' }));

    expect(getOutboxUser()).toBeNull();
    expect(localStorage.getItem('mc-offline-user')).toBeNull();
  });

  it('keeps queued entries of the previous user (they sync when that user signs back in)', async () => {
    localStorage.setItem('mc-offline-user', 'user_a');
    await store.put(item({ userId: 'user_a' }));
    authState.userId = 'user_b';

    render(<OfflineSyncProvider><div /></OfflineSyncProvider>);

    await waitFor(() => expect(postMessage).toHaveBeenCalled());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.all()).toHaveLength(1);
  });

  it('replays when the connection comes back', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    fetchMock.mockRejectedValue(new TypeError('offline'));
    render(<OfflineSyncProvider><div /></OfflineSyncProvider>);
    await waitFor(() => expect(getOutboxUser()).toBe('user_a'));
    await store.put(item({}));
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 201 }));

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(async () => expect(await store.all()).toHaveLength(0));
  });

  it('replays when the app comes back to the foreground', async () => {
    render(<OfflineSyncProvider><div /></OfflineSyncProvider>);
    await waitFor(() => expect(getOutboxUser()).toBe('user_a'));
    await store.put(item({}));

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(async () => expect(await store.all()).toHaveLength(0));
  });

  it('does not try to replay while the device reports offline', async () => {
    render(<OfflineSyncProvider><div /></OfflineSyncProvider>);
    await waitFor(() => expect(getOutboxUser()).toBe('user_a'));
    fetchMock.mockClear();
    await store.put(item({}));
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders its children', () => {
    const { getByText } = render(<OfflineSyncProvider><p>dashboard</p></OfflineSyncProvider>);

    expect(getByText('dashboard')).toBeInTheDocument();
  });
});
