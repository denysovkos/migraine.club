import type { OutboxItem } from '@/libs/offline/outboxStore';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setOutboxStoreForTests, setOutboxUser } from '@/libs/offline/outbox';
import { createMemoryOutboxStore } from '@/libs/offline/outboxStore';
import { OfflineSyncIndicator } from './OfflineSyncIndicator';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${Object.values(params).join(',')})` : key,
  useFormatter: () => ({ dateTime: () => 'Nov 16, 10:00' }),
}));

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const showSnackbarMock = vi.fn();
vi.mock('@/features/snackbar', () => ({ showSnackbar: (...args: unknown[]) => showSnackbarMock(...args) }));

function item(overrides: Partial<OutboxItem>): OutboxItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    userId: 'user_a',
    kind: 'attack',
    label: null,
    url: '/api/quick-add/episode',
    method: 'POST',
    body: '{}',
    createdAt: Date.now(),
    attempts: 0,
    status: 'pending',
    lastError: null,
    ...overrides,
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

let store = createMemoryOutboxStore();

beforeEach(() => {
  store = createMemoryOutboxStore();
  __setOutboxStoreForTests(store);
  setOutboxUser(null);
  setOutboxUser('user_a');
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
  refreshMock.mockReset();
  showSnackbarMock.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OfflineSyncIndicator', () => {
  it('renders nothing while online with nothing queued', async () => {
    const { container } = render(<OfflineSyncIndicator />);
    await act(async () => {});

    expect(container).toBeEmptyDOMElement();
  });

  it('tells the user they can still log when offline', async () => {
    render(<OfflineSyncIndicator />);
    act(() => setOnline(false));

    expect(await screen.findByRole('button', { name: 'status_offline' })).toBeDisabled();
  });

  it('counts the entries waiting while offline', async () => {
    await store.put(item({ id: 'a' }));
    await store.put(item({ id: 'b', kind: 'dose', label: 'Ibuprofen' }));
    setOnline(false);

    render(<OfflineSyncIndicator />);

    expect(await screen.findByRole('button', { name: 'status_offline_pending(2)' })).toBeEnabled();
  });

  it('lists what is stored on the device, with labels', async () => {
    await store.put(item({ id: 'b', kind: 'dose', label: 'Ibuprofen' }));
    setOnline(false);
    render(<OfflineSyncIndicator />);

    await userEvent.click(await screen.findByRole('button', { name: /status_offline_pending/ }));

    expect(screen.getByText('kind_dose · Ibuprofen')).toBeInTheDocument();
    expect(screen.getByText('state_pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'waiting_for_connection' })).toBeDisabled();
  });

  it('ignores entries of other accounts on the device', async () => {
    await store.put(item({ id: 'x', userId: 'user_b' }));
    const { container } = render(<OfflineSyncIndicator />);
    await act(async () => {});

    expect(container).toBeEmptyDOMElement();
  });

  it('flags rejected entries and lets the user retry them', async () => {
    await store.put(item({ id: 'f', status: 'failed', lastError: 'Health data consent required', kind: 'diary', label: '2026-11-16' }));
    const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<OfflineSyncIndicator />);

    await userEvent.click(await screen.findByRole('button', { name: 'status_failed(1)' }));

    expect(screen.getByText('state_failed · Health data consent required')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'retry' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/quick-add/episode', expect.anything()));
    await waitFor(async () => expect(await store.all()).toHaveLength(0));
  });

  it('discards a rejected entry only after confirmation', async () => {
    await store.put(item({ id: 'f', status: 'failed' }));
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<OfflineSyncIndicator />);
    await userEvent.click(await screen.findByRole('button', { name: 'status_failed(1)' }));

    await userEvent.click(screen.getByRole('button', { name: 'discard' }));

    expect(await store.all()).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'discard' }));

    await waitFor(async () => expect(await store.all()).toHaveLength(0));

    expect(confirmMock).toHaveBeenCalledWith('discard_confirm');
  });

  it('confirms once a backlog has synced and refreshes the page data', async () => {
    await store.put(item({ id: 'a' }));
    await store.put(item({ id: 'b' }));
    setOnline(false);
    render(<OfflineSyncIndicator />);
    await screen.findByRole('button', { name: 'status_offline_pending(2)' });

    act(() => setOnline(true));

    expect(await screen.findByRole('button', { name: 'status_syncing(2)' })).toBeInTheDocument();

    // Simulate the provider's replay finishing.
    await act(async () => {
      const { flushOutbox } = await import('@/libs/offline/outbox');
      await flushOutbox();
    });

    await waitFor(() => expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'synced_toast(2)' }));

    expect(refreshMock).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /status_/ })).not.toBeInTheDocument();
  });

  it('reports partial failure after a sync', async () => {
    await store.put(item({ id: 'a', createdAt: 1 }));
    await store.put(item({ id: 'b', createdAt: 2 }));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad' }), { status: 400 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 })));
    setOnline(false);
    render(<OfflineSyncIndicator />);
    await screen.findByRole('button', { name: 'status_offline_pending(2)' });
    act(() => setOnline(true));

    await act(async () => {
      const { flushOutbox } = await import('@/libs/offline/outbox');
      await flushOutbox();
    });

    await waitFor(() => expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'synced_toast(1)' }));

    expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'failed_toast' });
    expect(await screen.findByRole('button', { name: 'status_failed(1)' })).toBeInTheDocument();
  });

  it('"Sync now" replays and explains when the session has expired', async () => {
    await store.put(item({ id: 'a' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    render(<OfflineSyncIndicator />);

    await userEvent.click(await screen.findByRole('button', { name: 'status_syncing(1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'sync_now' }));

    await waitFor(() => expect(showSnackbarMock).toHaveBeenCalledWith({ message: 'signin_needed' }));

    expect(await store.all()).toHaveLength(1);
  });
});
