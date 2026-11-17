'use client';

import type { QuickAddSuggestion } from '@/types/Medications';
import { Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EditMedicationIntakeSheet } from '@/features/quickAdd/EditMedicationIntakeSheet';
import {
  deleteEpisode,
  fetchQuickAddSuggestions,
  quickAddCreateIntake,
  quickAddStartEpisodeNow,
  quickAddUndoIntake,
} from '@/features/quickAdd/quickAddApi';
import { showSnackbar } from '@/features/snackbar';

type SearchResult
  = | {
    kind: 'user';
    userMedicationId: string;
    label: string;
    defaultDose: string | null;
    defaultUnit: string | null;
    defaultUnitIsCustom: boolean;
    isPinned: boolean;
  }
  | {
    kind: 'catalog';
    catalogMedicationId: string;
    label: string;
  };

export function QuickAddFab() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'root' | 'med'>('root');

  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<QuickAddSuggestion[]>([]);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editState, setEditState] = useState<{
    intakeId: string | null;
    label: string;
    dose: string | null;
    unit: string | null;
    unitIsCustom: boolean;
  } | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const searchControllerRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open && mode === 'med') {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open, mode]);

  async function loadSuggestions() {
    controllerRef.current?.abort();
    const c = new AbortController();
    controllerRef.current = c;
    setLoading(true);
    try {
      const data = await fetchQuickAddSuggestions({ signal: c.signal });
      setSuggestions(data.topMeds);
    } catch {
      // ignore; rail on dashboard will show errors
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setMode('root');
      setQuery('');
      setResults([]);
      return;
    }
    loadSuggestions();
  }, [open]);

  const canSearch = useMemo(() => mode === 'med', [mode]);

  useEffect(() => {
    if (!open || !canSearch) {
      return;
    }
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    searchControllerRef.current?.abort();
    const c = new AbortController();
    searchControllerRef.current = c;
    setSearching(true);

    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/medications/search?q=${encodeURIComponent(q)}`, {
          cache: 'no-store',
          signal: c.signal,
        });
        const data = await res.json().catch(() => ({ results: [] }));
        if (res.ok) {
          setResults(data.results ?? []);
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [open, canSearch, query]);

  async function startEpisodeNow() {
    const controller = new AbortController();
    let episodeId: number | null = null;
    let undone = false;

    const promise = quickAddStartEpisodeNow({ signal: controller.signal })
      .then((r) => {
        if (r.queued) {
          return undefined;
        }
        episodeId = r.episodeId;
        if (undone) {
          return deleteEpisode(r.episodeId).catch(() => {});
        }
        return undefined;
      })
      .catch((e: any) => {
        showSnackbar({ message: e.message || 'Failed to start episode' });
      })
      .finally(() => {
        router.refresh();
      });

    setOpen(false);
    showSnackbar({
      message: 'Episode started',
      actions: [
        {
          label: 'Undo',
          onClick: async () => {
            undone = true;
            controller.abort();
            if (episodeId) {
              await deleteEpisode(episodeId);
              router.refresh();
            } else {
              await promise;
            }
          },
        },
        {
          label: 'Edit',
          onClick: async () => {
            if (!episodeId) {
              await promise;
            }
            if (episodeId) {
              router.push(`/dashboard/episodes/${episodeId}`);
            }
          },
        },
      ],
    });
  }

  async function logIntake(args: {
    label: string;
    payload: any;
    initialDose: string | null;
    initialUnit: string | null;
    unitIsCustom: boolean;
  }) {
    const controller = new AbortController();
    let intakeId: string | null = null;
    let undone = false;

    const promise = quickAddCreateIntake(args.payload, { signal: controller.signal })
      .then((r) => {
        if (r.queued) {
          return undefined;
        }
        intakeId = r.intakeId;
        if (undone) {
          return quickAddUndoIntake(r.intakeId).catch(() => {});
        }
        return undefined;
      })
      .catch((e: any) => {
        showSnackbar({ message: e.message || 'Failed to log medication' });
      })
      .finally(() => {
        loadSuggestions();
      });

    setOpen(false);

    showSnackbar({
      message: `${args.label} logged`,
      actions: [
        {
          label: 'Undo',
          onClick: async () => {
            undone = true;
            controller.abort();
            if (intakeId) {
              await quickAddUndoIntake(intakeId);
              loadSuggestions();
            } else {
              await promise;
            }
          },
        },
        {
          label: 'Edit',
          onClick: async () => {
            if (!intakeId) {
              await promise;
            }
            if (!intakeId) {
              return;
            }
            setEditState({
              intakeId,
              label: args.label,
              dose: args.initialDose,
              unit: args.initialUnit,
              unitIsCustom: args.unitIsCustom,
            });
            setEditOpen(true);
          },
        },
      ],
    });
  }

  return (
    <>
      {/* Mobile-first FAB */}
      <button
        type="button"
        className="fixed bottom-4 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 md:bottom-6 md:right-6"
        onClick={() => setOpen(true)}
        aria-label="Quick add"
      >
        <Plus className="size-6" />
      </button>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={mode === 'root' ? 'Quick add' : 'Take medication'}
      >
        {mode === 'root' && (
          <div className="space-y-3">
            <Button className="h-12 w-full" onClick={startEpisodeNow}>
              Start episode now
            </Button>

            <Button
              className="h-12 w-full"
              variant="outline"
              onClick={() => setMode('med')}
            >
              Take medication
            </Button>

            <div className="pt-2 text-xs text-muted-foreground">
              Tip: “Take medication” shows your last 90-day Top 5.
            </div>
          </div>
        )}

        {mode === 'med' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                className="h-11 pl-9"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search medications"
              />
            </div>

            {/* Top 5 suggestions */}
            <div className="space-y-2">
              {loading && (
                <>
                  <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
                  <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
                </>
              )}

              {!loading && suggestions.slice(0, 5).map((s) => {
                const suffix = [s.suggestedDose, s.suggestedUnit].filter(Boolean).join(' ');
                return (
                  <button
                    type="button"
                    key={s.userMedicationId}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm hover:bg-muted"
                    onClick={() =>
                      logIntake({
                        label: s.label,
                        payload: {
                          userMedicationId: s.userMedicationId,
                          dose: s.suggestedDose ?? undefined,
                          unit: s.suggestedUnit ?? undefined,
                          unitIsCustom: s.unitIsCustom ?? undefined,
                        },
                        initialDose: s.suggestedDose,
                        initialUnit: s.suggestedUnit,
                        unitIsCustom: s.unitIsCustom,
                      })}
                  >
                    <span className="min-w-0 truncate font-medium">{s.label}</span>
                    {suffix && <span className="shrink-0 text-muted-foreground">{suffix}</span>}
                  </button>
                );
              })}
            </div>

            {/* Search results */}
            {(searching || results.length > 0 || query.trim().length > 0) && (
              <div className="space-y-2 border-t pt-3">
                <div className="text-xs font-medium text-muted-foreground">
                  {searching ? 'Searching…' : 'Results'}
                </div>

                {results.map((r) => {
                  if (r.kind === 'user') {
                    const suffix = [r.defaultDose, r.defaultUnit].filter(Boolean).join(' ');
                    return (
                      <button
                        type="button"
                        key={`u:${r.userMedicationId}`}
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm hover:bg-muted"
                        onClick={() =>
                          logIntake({
                            label: r.label,
                            payload: {
                              userMedicationId: r.userMedicationId,
                              dose: r.defaultDose ?? undefined,
                              unit: r.defaultUnit ?? undefined,
                              unitIsCustom: r.defaultUnitIsCustom,
                            },
                            initialDose: r.defaultDose,
                            initialUnit: r.defaultUnit,
                            unitIsCustom: r.defaultUnitIsCustom,
                          })}
                      >
                        <span className="min-w-0 truncate font-medium">{r.label}</span>
                        {suffix && <span className="shrink-0 text-muted-foreground">{suffix}</span>}
                      </button>
                    );
                  }

                  return (
                    <button
                      type="button"
                      key={`c:${r.catalogMedicationId}`}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm hover:bg-muted"
                      onClick={() =>
                        logIntake({
                          label: r.label,
                          payload: { catalogMedicationId: r.catalogMedicationId },
                          initialDose: null,
                          initialUnit: null,
                          unitIsCustom: false,
                        })}
                    >
                      <span className="min-w-0 truncate font-medium">{r.label}</span>
                      <span className="shrink-0 text-muted-foreground">Catalog</span>
                    </button>
                  );
                })}

                {query.trim() && (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-dashed bg-background px-3 text-left text-sm hover:bg-muted"
                    onClick={() =>
                      logIntake({
                        label: query.trim(),
                        payload: { customName: query.trim() },
                        initialDose: null,
                        initialUnit: null,
                        unitIsCustom: false,
                      })}
                  >
                    <span className="min-w-0 truncate font-medium">
                      Add custom “
                      {query.trim()}
                      ”
                    </span>
                    <span className="shrink-0 text-muted-foreground">Custom</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      <EditMedicationIntakeSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        intakeId={editState?.intakeId ?? null}
        label={editState?.label ?? 'Medication'}
        initialDose={editState?.dose ?? null}
        initialUnit={editState?.unit ?? null}
        initialUnitIsCustom={editState?.unitIsCustom ?? false}
        onSaved={() => loadSuggestions()}
      />
    </>
  );
}
