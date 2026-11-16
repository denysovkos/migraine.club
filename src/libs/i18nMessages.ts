import type { SupportedLanguageType } from '@/models/Schema';
import { AppConfig } from '@/utils/AppConfig';

type Messages = Record<string, unknown>;

function getByPath(obj: Messages, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function format(template: string, values?: Record<string, string | number | null | undefined>): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    return v === null || v === undefined ? '' : String(v);
  });
}

async function loadMessages(locale: SupportedLanguageType): Promise<Messages> {
  // Mirror next-intl dynamic import pattern used in src/libs/i18n.ts
  return (await import(`../locales/${locale}.json`)).default as Messages;
}

/**
 * Minimal server-side translator for non-request contexts (cron jobs, services).
 * Uses dot-path keys (e.g. namespace 'Push', key 'dailyRisk.title').
 */
export async function getServerTranslator(
  locale: SupportedLanguageType | null | undefined,
  namespace: string,
): Promise<(key: string, values?: Record<string, string | number | null | undefined>) => string> {
  const safeLocale = (locale ?? AppConfig.defaultLocale) as SupportedLanguageType;
  const messages = await loadMessages(safeLocale);

  return (key, values) => {
    const fullKey = `${namespace}.${key}`;
    const raw = getByPath(messages, fullKey);
    if (typeof raw !== 'string') {
      // Fail softly in background jobs; avoid throwing and breaking alert delivery.
      return fullKey;
    }
    return format(raw, values);
  };
}
