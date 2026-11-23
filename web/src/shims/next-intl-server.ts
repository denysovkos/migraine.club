// next-intl/server in the browser: the same translator, over the messages
// of the locale the route renders in.
import { createFormatter, createTranslator } from 'use-intl/core';

import { currentLocale, loadLocale } from './locale-state';

type Opts = string | undefined | { locale?: string; namespace?: string };

export async function getTranslations(opts?: Opts) {
  const namespace = typeof opts === 'object' ? opts.namespace : opts;
  const locale = typeof opts === 'object' && opts.locale ? opts.locale : currentLocale().locale;
  const { messages } = locale === currentLocale().locale ? currentLocale() : await loadLocale(locale);
  return createTranslator({ locale, messages, namespace: namespace as never, timeZone: 'UTC' });
}

export async function getMessages(_opts?: { locale?: string }) {
  return currentLocale().messages;
}

export async function getLocale() {
  return currentLocale().locale;
}

export async function getTimeZone() {
  return 'UTC';
}

export async function getNow() {
  return new Date();
}

export async function getFormatter(_opts?: { locale?: string }) {
  return createFormatter({ locale: currentLocale().locale, timeZone: 'UTC' });
}

export function setRequestLocale(_locale: string) {}

export function getRequestConfig<T>(fn: T): T {
  return fn;
}
