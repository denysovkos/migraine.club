import { sendOrQueue } from '@/libs/offline/outbox';

type FactorType = 'trigger' | 'protector' | 'symptom';

type BuiltInFactorOption = Readonly<{
  key: string;
  translationKey: string;
  logged: boolean;
}>;

type RecentFactorOption = Readonly<{
  factorId: string;
  displayName: string;
  type: Extract<FactorType, 'trigger' | 'protector'>;
  key: string | null;
}>;

export type FactorOptionsResponse = Readonly<{
  trigger: {
    builtIns: BuiltInFactorOption[];
    recent: RecentFactorOption[];
  };
  protector: {
    builtIns: BuiltInFactorOption[];
    recent: RecentFactorOption[];
  };
}>;

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toOccurredAtIso(localDate: string): string {
  if (!LOCAL_DATE_RE.test(localDate)) {
    throw new Error('Invalid localDate');
  }

  const [yearText, monthText, dayText] = localDate.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const localNoon = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (
    Number.isNaN(localNoon.getTime())
    || localNoon.getFullYear() !== year
    || localNoon.getMonth() !== month - 1
    || localNoon.getDate() !== day
  ) {
    throw new Error('Invalid localDate');
  }

  return localNoon.toISOString();
}

export async function fetchFactorOptions(localDate?: string): Promise<FactorOptionsResponse> {
  const url = new URL('/api/factors/options', window.location.origin);
  if (localDate) {
    url.searchParams.set('localDate', localDate);
  }

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Failed to load factor options');
  }

  return res.json();
}

/** Log a trigger/protector. Works offline: queued with its time. */
export async function logFactorEvent(args: {
  displayName: string;
  type: FactorType;
  localDate?: string;
}) {
  const occurredAt = args.localDate ? toOccurredAtIso(args.localDate) : new Date().toISOString();
  const result = await sendOrQueue({
    url: '/api/factors/log',
    method: 'POST',
    body: {
      displayName: args.displayName,
      type: args.type,
      occurredAt,
    },
    kind: 'factor',
    label: args.displayName,
  });
  if (result.queued) {
    return { queued: true as const };
  }
  const res = result.response;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Failed to log factor');
  }

  return res.json();
}
