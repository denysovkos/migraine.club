'use client';

import type { TakeMedicationSelection } from '@/features/quickAdd/TakeMedicationSheet';
import type { QuickAddSuggestion } from '@/types/Medications';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  deleteEpisode,
  fetchQuickAddSuggestions,
  quickAddStartEpisodeNow,
} from '@/features/quickAdd/quickAddApi';
import { TakeMedicationSheet } from '@/features/quickAdd/TakeMedicationSheet';
import { showSnackbar } from '@/features/snackbar';

export function QuickAddRail(props: { onDidLog?: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<QuickAddSuggestion[]>([]);
  const [hasOngoingEpisode, setHasOngoingEpisode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [takeOpen, setTakeOpen] = useState(false);
  const [initialSelection, setInitialSelection] = useState<TakeMedicationSelection | null>(null);

  const lastController = useRef<AbortController | null>(null);

  async function refresh() {
    lastController.current?.abort();
    const c = new AbortController();
    lastController.current = c;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchQuickAddSuggestions({ signal: c.signal });
      setSuggestions(data.topMeds);
      setHasOngoingEpisode(data.hasOngoingEpisode);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e.message || 'Failed');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    return () => lastController.current?.abort();
  }, []);

  async function startEpisodeNow() {
    const controller = new AbortController();
    let episodeId: number | null = null;
    let undone = false;

    const promise = quickAddStartEpisodeNow({ signal: controller.signal })
      .then((r) => {
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
        props.onDidLog?.();
        router.refresh();
      });

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

  return (
    <>
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3">
          <div className="text-base font-medium">Quick add</div>
          <div className="text-sm text-muted-foreground">Fast logging, mobile-first.</div>
        </div>

        <div className="space-y-2">
          {!hasOngoingEpisode
            ? (
                <>
                  <Button className="h-12 w-full" onClick={startEpisodeNow}>
                    Start episode now
                  </Button>
                  <Button className="h-12 w-full" variant="outline" onClick={() => setTakeOpen(true)}>
                    Take medication
                  </Button>
                </>
              )
            : (
                <Button className="h-12 w-full" onClick={() => setTakeOpen(true)}>
                  Take medication
                </Button>
              )}

          {loading && (
            <div className="space-y-2">
              <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
              <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
              <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
            </div>
          )}

          {!loading && error && (
            <div className="text-sm text-destructive">{error}</div>
          )}

          {!loading && !error && (
            <div className="space-y-2">
              {suggestions.slice(0, 5).map((s) => {
                const suffix = [s.suggestedDose, s.suggestedUnit].filter(Boolean).join(' ');
                return (
                  <button
                    type="button"
                    key={s.userMedicationId}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setInitialSelection({
                        label: s.label,
                        payload: { userMedicationId: s.userMedicationId },
                        suggestedDose: s.suggestedDose,
                        suggestedUnit: s.suggestedUnit,
                        unitIsCustom: s.unitIsCustom,
                      });
                      setTakeOpen(true);
                    }}
                  >
                    <span className="min-w-0 truncate font-medium">{s.label}</span>
                    {suffix && (
                      <span className="shrink-0 text-muted-foreground">{suffix}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <TakeMedicationSheet
        open={takeOpen}
        onOpenChange={(open) => {
          setTakeOpen(open);
          if (!open) {
            setInitialSelection(null);
          }
        }}
        initialSelection={initialSelection}
        onDidLog={() => {
          props.onDidLog?.();
          refresh();
        }}
      />
    </>
  );
}
