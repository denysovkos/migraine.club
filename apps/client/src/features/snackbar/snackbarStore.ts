'use client';

import { useSyncExternalStore } from 'react';

export type SnackbarAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

export type SnackbarPayload = {
  message: string;
  actions?: SnackbarAction[];
  durationMs?: number; // null/undefined => default
};

type SnackbarState = {
  open: boolean;
  message: string;
  actions: SnackbarAction[];
};

let state: SnackbarState = { open: false, message: '', actions: [] };
const listeners = new Set<() => void>();
let hideTimer: number | null = null;

function emit() {
  for (const l of listeners) {
    l();
  }
}

export function showSnackbar(payload: SnackbarPayload) {
  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  state = {
    open: true,
    message: payload.message,
    actions: payload.actions ?? [],
  };
  emit();

  const duration = payload.durationMs ?? 6_000;
  hideTimer = window.setTimeout(() => {
    hideSnackbar();
  }, duration);
}

export function hideSnackbar() {
  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  state = { open: false, message: '', actions: [] };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

export function useSnackbarState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
