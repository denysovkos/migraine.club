'use client';

import type { MedicationDoseSnapshot } from '@/features/quickAdd/medicationPickerLogic';
import { Search, X } from 'lucide-react';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getOneTapDecision,
  normalizeDoseInput,
  normalizeSearchText,
  resolveKnownDose,
} from '@/features/quickAdd/medicationPickerLogic';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useVisualViewportKeyboardOffset } from '@/hooks/useVisualViewportKeyboardOffset';
import { DoseUnitOptions } from '@/types/Medications';
import { cn } from '@/utils/Helpers';

export type MedicationPickerMyMedication = MedicationDoseSnapshot & {
  id: string;
  label: string;
  isPinned?: boolean;
};

export type MedicationPickerCatalogMedication = {
  id: string;
  label: string;
};

export function MedicationPickerSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pinnedMeds: MedicationPickerMyMedication[];
  recentMeds: MedicationPickerMyMedication[];
  myMeds: MedicationPickerMyMedication[];
  catalogSearchFn: (query: string, signal?: AbortSignal) => Promise<MedicationPickerCatalogMedication[]>;
  onLogDose: (args: {
    medication:
      | { kind: 'my'; medication: MedicationPickerMyMedication }
      | { kind: 'catalog'; medication: MedicationPickerCatalogMedication };
    dose: string | null;
    unit: string | null;
    unitIsCustom: boolean;
  }) => Promise<void>;
  hasOngoingEpisode?: boolean;
  initialSelection?: {
    kind: 'my' | 'catalog';
    medicationId: string;
    dose?: string | null;
    unit?: string | null;
    unitIsCustom?: boolean;
  } | null;
}) {
  const {
    open,
    onOpenChange,
    pinnedMeds,
    recentMeds,
    myMeds,
    catalogSearchFn,
    onLogDose,
    hasOngoingEpisode,
    initialSelection,
  } = props;
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'my' | 'catalog'>('my');
  const [selectedMedicationId, setSelectedMedicationId] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<'my' | 'catalog'>('my');
  const [selectedDose, setSelectedDose] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('mg');
  const [selectedUnitIsCustom, setSelectedUnitIsCustom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogResults, setCatalogResults] = useState<MedicationPickerCatalogMedication[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const doseInputRef = useRef<HTMLInputElement | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useBodyScrollLock(open);
  const keyboardOffset = useVisualViewportKeyboardOffset(open);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
      setSelectedMedicationId(null);
      setSelectedDose('');
      setSelectedUnit('mg');
      setSelectedUnitIsCustom(false);
      setCatalogResults([]);
      setActiveTab('my');
      return;
    }

    if (initialSelection) {
      setSelectedKind(initialSelection.kind);
      setSelectedMedicationId(initialSelection.medicationId);
      setSelectedDose(initialSelection.dose ?? '');
      setSelectedUnit(initialSelection.unit ?? 'mg');
      setSelectedUnitIsCustom(initialSelection.unitIsCustom ?? false);
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [initialSelection, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const setViewportVar = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--app-dvh', `${vh}px`);
    };
    setViewportVar();
    window.addEventListener('resize', setViewportVar);
    return () => {
      window.removeEventListener('resize', setViewportVar);
    };
  }, [open]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const myMatches = useMemo(() => {
    const needle = normalizeSearchText(debouncedQuery);
    if (!needle) {
      return myMeds;
    }
    return myMeds.filter(med => normalizeSearchText(med.label).includes(needle));
  }, [debouncedQuery, myMeds]);

  const shouldShowCatalog = activeTab === 'catalog' || (debouncedQuery.length > 0 && myMatches.length === 0);

  useEffect(() => {
    if (!open || !debouncedQuery || !shouldShowCatalog) {
      setCatalogResults([]);
      setCatalogLoading(false);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setCatalogLoading(true);

    catalogSearchFn(debouncedQuery, controller.signal)
      .then(setCatalogResults)
      .catch(() => setCatalogResults([]))
      .finally(() => setCatalogLoading(false));

    return () => controller.abort();
  }, [catalogSearchFn, debouncedQuery, open, shouldShowCatalog]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
        return;
      }
      if (e.key === 'Tab') {
        const root = containerRef.current;
        if (!root) {
          return;
        }
        if (!root.contains(document.activeElement)) {
          return;
        }
        trapFocus(e);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange, open]);

  const selectedMyMedication = useMemo(
    () => myMeds.find(m => m.id === selectedMedicationId) ?? null,
    [myMeds, selectedMedicationId],
  );
  const selectedCatalogMedication = useMemo(
    () => catalogResults.find(m => m.id === selectedMedicationId) ?? null,
    [catalogResults, selectedMedicationId],
  );

  const selectedLabel = selectedKind === 'my'
    ? (selectedMyMedication?.label ?? '')
    : (selectedCatalogMedication?.label ?? '');

  const selectedUnitValue = selectedUnit.trim() || 'mg';
  const selectedExists = Boolean(selectedMedicationId);

  function clearSelectionAndFocusSearch() {
    setSelectedMedicationId(null);
    setSelectedDose('');
    setSelectedUnit('mg');
    setSelectedUnitIsCustom(false);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  async function executeLog(args: {
    medication:
      | { kind: 'my'; medication: MedicationPickerMyMedication }
      | { kind: 'catalog'; medication: MedicationPickerCatalogMedication };
    skipDose: boolean;
    presetDose?: string | null;
    presetUnit?: string | null;
    presetUnitIsCustom?: boolean;
  }) {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const normalized = normalizeDoseInput(args.presetDose ?? selectedDose);
      await onLogDose({
        medication: args.medication,
        dose: args.skipDose ? null : (normalized || null),
        unit: args.skipDose ? null : ((args.presetUnit ?? selectedUnitValue) || 'mg'),
        unitIsCustom: args.skipDose ? false : (args.presetUnitIsCustom ?? selectedUnitIsCustom),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMyMedicationPress(medication: MedicationPickerMyMedication) {
    const decision = getOneTapDecision(medication);
    if (decision === 'log-now') {
      const known = resolveKnownDose(medication);
      await executeLog({
        medication: { kind: 'my', medication },
        skipDose: false,
        presetDose: known.dose,
        presetUnit: known.unit,
        presetUnitIsCustom: known.unitIsCustom,
      });
      return;
    }

    setSelectedKind('my');
    setSelectedMedicationId(medication.id);
    setSelectedDose(medication.lastUsedDose ?? '');
    setSelectedUnit(medication.lastUsedUnit ?? medication.defaultUnit ?? 'mg');
    setSelectedUnitIsCustom(medication.lastUsedUnitIsCustom || medication.defaultUnitIsCustom);
    window.requestAnimationFrame(() => doseInputRef.current?.focus());
  }

  function handleCatalogMedicationPress(medication: MedicationPickerCatalogMedication) {
    setSelectedKind('catalog');
    setSelectedMedicationId(medication.id);
    setSelectedDose('');
    setSelectedUnit('mg');
    setSelectedUnitIsCustom(false);
    window.requestAnimationFrame(() => doseInputRef.current?.focus());
  }

  async function onPrimaryLog() {
    if (!selectedMedicationId) {
      return;
    }
    if (selectedKind === 'my' && selectedMyMedication) {
      await executeLog({ medication: { kind: 'my', medication: selectedMyMedication }, skipDose: false });
    }
    if (selectedKind === 'catalog' && selectedCatalogMedication) {
      await executeLog({ medication: { kind: 'catalog', medication: selectedCatalogMedication }, skipDose: false });
    }
  }

  async function onSkipDose() {
    if (!selectedMedicationId) {
      return;
    }
    if (selectedKind === 'my' && selectedMyMedication) {
      await executeLog({ medication: { kind: 'my', medication: selectedMyMedication }, skipDose: true });
    }
    if (selectedKind === 'catalog' && selectedCatalogMedication) {
      await executeLog({ medication: { kind: 'catalog', medication: selectedCatalogMedication }, skipDose: true });
    }
  }

  async function onSearchInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') {
      return;
    }
    const top = myMatches[0];
    if (!top) {
      return;
    }
    e.preventDefault();
    await handleMyMedicationPress(top);
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== 'Tab') {
      return;
    }
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const selectors = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      'a[href]',
      'textarea:not([disabled])',
    ].join(',');
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(selectors))
      .filter(node => node.offsetParent !== null);
    if (nodes.length === 0) {
      return;
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement as HTMLElement | null;

    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50" aria-hidden={false}>
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close take medication sheet"
        onClick={() => onOpenChange(false)}
      />

      <div className="absolute inset-0 flex items-end justify-center p-0 md:p-4">
        <div
          ref={containerRef}
          className={cn(
            'modal-sheet relative flex h-full w-full flex-col bg-card shadow-xl',
            'md:h-auto md:max-h-[min(90dvh,860px)] md:max-w-[640px] md:rounded-2xl md:border',
          )}
          style={{ height: '100dvh', maxHeight: '100dvh' }}
          role="dialog"
          aria-modal="true"
          aria-label="Take medication"
        >
          <header className="flex-none border-b px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Take medication</h2>
              <button
                type="button"
                className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                className="h-11 pl-9"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onSearchInputKeyDown}
                placeholder="Search medications"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={cn(
                  'min-h-12 rounded-md border px-3 text-sm',
                  activeTab === 'my' ? 'bg-primary text-primary-foreground' : 'bg-background',
                )}
                onClick={() => setActiveTab('my')}
              >
                My meds
              </button>
              <button
                type="button"
                className={cn(
                  'min-h-12 rounded-md border px-3 text-sm',
                  activeTab === 'catalog' ? 'bg-primary text-primary-foreground' : 'bg-background',
                )}
                onClick={() => setActiveTab('catalog')}
              >
                Catalog
              </button>
            </div>
            {hasOngoingEpisode && (
              <div className="mt-2 text-xs text-muted-foreground">
                Will be linked to current episode
              </div>
            )}
          </header>

          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch]">
            {!debouncedQuery && pinnedMeds.length > 0 && (
              <section className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Pinned</h3>
                <div className="space-y-2">
                  {pinnedMeds.slice(0, 6).map(med => (
                    <button
                      key={`p:${med.id}`}
                      type="button"
                      className="min-h-12 w-full rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => handleMyMedicationPress(med)}
                    >
                      {med.label}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {!debouncedQuery && recentMeds.length > 0 && (
              <section className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Recent</h3>
                <div className="space-y-2">
                  {recentMeds.slice(0, 6).map(med => (
                    <button
                      key={`r:${med.id}`}
                      type="button"
                      className="min-h-12 w-full rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => handleMyMedicationPress(med)}
                    >
                      {med.label}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Results (My meds)</h3>
              <div className="space-y-2">
                {myMatches.map(med => (
                  <button
                    key={`m:${med.id}`}
                    type="button"
                    className="min-h-12 w-full rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => handleMyMedicationPress(med)}
                  >
                    {med.label}
                  </button>
                ))}
                {myMatches.length === 0 && (
                  <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                    No medications found in My meds.
                  </div>
                )}
              </div>
            </section>

            {shouldShowCatalog && (
              <section className="pb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Catalog</h3>
                {catalogLoading
                  ? (
                      <div className="space-y-2">
                        <div className="h-12 animate-pulse rounded-md bg-muted" />
                        <div className="h-12 animate-pulse rounded-md bg-muted" />
                      </div>
                    )
                  : (
                      <CatalogList
                        items={catalogResults}
                        onClick={handleCatalogMedicationPress}
                      />
                    )}
              </section>
            )}
          </div>

          <footer
            className="flex-none border-t bg-card px-4 py-3"
            style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + ${keyboardOffset}px + 12px)` }}
          >
            {!selectedExists && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Select a medication</div>
                <Button className="h-12 w-full" disabled>
                  Log now
                </Button>
              </div>
            )}

            {selectedExists && (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="line-clamp-2 text-sm font-medium">{selectedLabel}</div>
                  <button
                    type="button"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                    onClick={clearSelectionAndFocusSearch}
                  >
                    Change
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    ref={doseInputRef}
                    value={selectedDose}
                    onChange={e => setSelectedDose(normalizeDoseInput(e.target.value))}
                    inputMode="decimal"
                    placeholder="Dose"
                    className="col-span-2 h-11"
                  />
                  <select
                    className="h-11 rounded-md border bg-background px-2 text-sm"
                    value={selectedUnit}
                    onChange={(e) => {
                      const value = e.target.value || 'mg';
                      setSelectedUnit(value);
                      setSelectedUnitIsCustom(!DoseUnitOptions.includes(value as (typeof DoseUnitOptions)[number]));
                    }}
                  >
                    {DoseUnitOptions.map(unit => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  className="h-12 w-full"
                  onClick={onPrimaryLog}
                  disabled={!selectedExists || submitting}
                >
                  {submitting ? 'Logging…' : 'Log now'}
                </Button>
                <button
                  type="button"
                  className="min-h-12 w-full rounded-md border bg-background px-3 text-sm hover:bg-muted disabled:opacity-50"
                  onClick={onSkipDose}
                  disabled={!selectedExists || submitting}
                >
                  Skip dose
                </button>
              </div>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}

function CatalogList(props: {
  items: MedicationPickerCatalogMedication[];
  onClick: (item: MedicationPickerCatalogMedication) => void;
}) {
  if (props.items.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        No catalog matches.
      </div>
    );
  }

  if (props.items.length <= 40) {
    return (
      <div className="space-y-2">
        {props.items.map(item => (
          <button
            type="button"
            key={item.id}
            className="flex min-h-12 w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => props.onClick(item)}
          >
            <span>{item.label}</span>
            <span className="text-muted-foreground">Add</span>
          </button>
        ))}
      </div>
    );
  }

  return <VirtualCatalogList items={props.items} onClick={props.onClick} />;
}

function VirtualCatalogList(props: {
  items: MedicationPickerCatalogMedication[];
  onClick: (item: MedicationPickerCatalogMedication) => void;
}) {
  const rowHeight = 56;
  const overscan = 6;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(320);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const sync = () => setHeight(frame.clientHeight || 320);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const endIndex = Math.min(props.items.length, startIndex + visibleCount);
  const visibleItems = props.items.slice(startIndex, endIndex);

  return (
    <div
      ref={frameRef}
      className="h-[320px] overflow-y-auto overscroll-contain"
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: props.items.length * rowHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${startIndex * rowHeight}px)` }}>
          {visibleItems.map(item => (
            <button
              type="button"
              key={item.id}
              className="mb-2 flex h-12 w-full items-center justify-between rounded-md border bg-background px-3 text-left text-sm hover:bg-muted"
              onClick={() => props.onClick(item)}
            >
              <span>{item.label}</span>
              <span className="text-muted-foreground">Add</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
