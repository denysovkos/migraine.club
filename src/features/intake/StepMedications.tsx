'use client';

import type { IntakeAcuteMedEntry, IntakePreventiveEntry } from '@/models/intake';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

// Matches the shape returned by GET /api/medications/search: both the
// caller's own saved medications ("user") and catalog suggestions
// ("catalog") come back with a pre-resolved display `label`, not the
// catalog's raw canonicalName.
type CatalogHit = {
  kind: 'user' | 'catalog';
  catalogMedicationId: string | null;
  label: string;
};

// A failed request and a genuine "no matches" must stay distinguishable: a
// custom entry gets no `medicationClass`, so silently treating a network
// blip as "no matches" would push a triptan into the wrong MOH threshold.
type SearchResult
  = | { status: 'ok'; hits: CatalogHit[] }
    | { status: 'error' };

type Props = {
  acute: IntakeAcuteMedEntry[];
  preventive: IntakePreventiveEntry[];
  onChange: (next: { acute: IntakeAcuteMedEntry[]; preventive: IntakePreventiveEntry[] }) => void;
};

const SEARCH_DEBOUNCE_MS = 200;

async function searchCatalog(term: string, signal?: AbortSignal): Promise<SearchResult> {
  if (term.trim().length < 2) {
    return { status: 'ok', hits: [] };
  }
  try {
    const res = await fetch(`/api/medications/search?q=${encodeURIComponent(term)}`, { cache: 'no-store', signal });
    if (!res.ok) {
      return { status: 'error' };
    }
    const data = await res.json().catch(() => null);
    if (!data) {
      return { status: 'error' };
    }
    return { status: 'ok', hits: (data?.results ?? []) as CatalogHit[] };
  } catch (err) {
    // An aborted request means a newer search superseded this one — that's
    // not a failure, so let the caller's sequencing guard silently drop it.
    if ((err as { name?: string } | undefined)?.name === 'AbortError') {
      throw err;
    }
    return { status: 'error' };
  }
}

export function StepMedications({ acute, preventive, onChange }: Props) {
  const t = useTranslations('Intake');
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [preventiveName, setPreventiveName] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // Debounce keystrokes before hitting the network.
  useEffect(() => {
    const timer = setTimeout(setDebouncedTerm, SEARCH_DEBOUNCE_MS, term);
    return () => clearTimeout(timer);
  }, [term]);

  // Fire the (abortable) search once the debounce settles. The in-flight
  // request is aborted before the next one starts, and any response that
  // arrives after being superseded is dropped rather than allowed to
  // overwrite newer results — so a slow earlier request can never clobber a
  // faster later one.
  useEffect(() => {
    abortRef.current?.abort();

    if (debouncedTerm.trim().length < 2) {
      setHits([]);
      setSearchFailed(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    searchCatalog(debouncedTerm, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        if (result.status === 'error') {
          setSearchFailed(true);
          setHits([]);
        } else {
          setSearchFailed(false);
          setHits(result.hits);
        }
      })
      .catch(() => {
        // Superseded by a newer search; nothing to do.
      });

    return () => controller.abort();
  }, [debouncedTerm, retryTick]);

  const addAcuteFromCatalog = (hit: CatalogHit) => {
    onChange({
      acute: [...acute, { catalogMedicationId: hit.catalogMedicationId ?? undefined, customName: hit.label }],
      preventive,
    });
    setTerm('');
    setDebouncedTerm('');
    setHits([]);
    setSearchFailed(false);
  };

  const addAcuteCustom = () => {
    const name = term.trim();
    if (!name) {
      return;
    }
    onChange({ acute: [...acute, { customName: name }], preventive });
    setTerm('');
    setDebouncedTerm('');
    setHits([]);
    setSearchFailed(false);
  };

  const removeAcute = (index: number) => {
    onChange({ acute: acute.filter((_, i) => i !== index), preventive });
  };

  const addPreventive = () => {
    const name = preventiveName.trim();
    if (!name) {
      return;
    }
    onChange({
      acute,
      preventive: [...preventive, { name, kind: 'oral', scheduleType: 'daily', startDate: null }],
    });
    setPreventiveName('');
  };

  const removePreventive = (index: number) => {
    onChange({ acute, preventive: preventive.filter((_, i) => i !== index) });
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('step_medications_title')}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm text-muted-foreground">{t('acute_label')}</h2>
        <input
          value={term}
          onChange={e => setTerm(e.target.value)}
          placeholder={t('med_search_placeholder')}
          className="min-h-[44px] rounded-lg border border-border px-3"
        />
        {hits.length > 0 && (
          <ul className="flex flex-col gap-1">
            {hits.map(hit => (
              <li key={`${hit.kind}-${hit.catalogMedicationId ?? hit.label}`}>
                <button
                  type="button"
                  onClick={() => addAcuteFromCatalog(hit)}
                  className="min-h-[44px] w-full rounded-lg border border-border px-3 text-left"
                >
                  {hit.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchFailed && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <span>{t('med_search_error')}</span>
            <button
              type="button"
              onClick={() => setRetryTick(n => n + 1)}
              className="min-h-[44px] shrink-0 px-2 underline"
            >
              {t('med_search_retry')}
            </button>
          </div>
        )}
        {term.trim().length > 0 && hits.length === 0 && (
          <button type="button" onClick={addAcuteCustom} className="min-h-[44px] rounded-lg border px-4">
            {t('add_custom_med', { name: term.trim() })}
          </button>
        )}
        <ul className="flex flex-wrap gap-2">
          {acute.map((m, i) => (
            <li
              key={`${m.catalogMedicationId ?? m.customName}-${i}`}
              className="flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-sm"
            >
              <span>{m.customName}</span>
              <button
                type="button"
                onClick={() => removeAcute(i)}
                aria-label={t('remove_medication', { name: m.customName ?? '' })}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm text-muted-foreground">{t('preventive_label')}</h2>
        <div className="flex gap-2">
          <input
            value={preventiveName}
            onChange={e => setPreventiveName(e.target.value)}
            placeholder={t('preventive_placeholder')}
            className="min-h-[44px] flex-1 rounded-lg border border-border px-3"
          />
          <button type="button" onClick={addPreventive} className="min-h-[44px] rounded-lg border px-4">
            {t('add')}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t('preventive_hint')}</p>
        <ul className="flex flex-wrap gap-2">
          {preventive.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-sm">
              <span>{p.name}</span>
              <button
                type="button"
                onClick={() => removePreventive(i)}
                aria-label={t('remove_preventive', { name: p.name })}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
