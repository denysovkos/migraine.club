'use client';

import { Pin, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { showSnackbar } from '@/features/snackbar';
import { DoseUnitOptions } from '@/types/Medications';

type UserMedicationRow = {
  id: string;
  label: string;
  defaultDose: string | null;
  defaultUnit: string | null;
  defaultUnitIsCustom: boolean;
  isPinned: boolean;
};

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

async function fetchUserMedications(): Promise<{ pinned: UserMedicationRow[]; recentlyUsed: UserMedicationRow[] }> {
  const res = await fetch('/api/user-medications', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to load');
  }
  return res.json();
}

async function patchUserMedication(id: string, patch: Partial<UserMedicationRow> & { defaultUnitIsCustom?: boolean }) {
  const res = await fetch(`/api/user-medications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed');
  }
}

async function createUserMedication(payload: { catalogMedicationId?: string; customName?: string }) {
  const res = await fetch('/api/user-medications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed');
  }
  return res.json() as Promise<{ userMedicationId: string }>;
}

export function MedicationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [pinned, setPinned] = useState<UserMedicationRow[]>([]);
  const [recentlyUsed, setRecentlyUsed] = useState<UserMedicationRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<UserMedicationRow | null>(null);
  const [editDose, setEditDose] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editUnitIsCustom, setEditUnitIsCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const addSearchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!addOpen) {
      return;
    }
    // BottomSheet mounts content on open; focus after paint.
    window.requestAnimationFrame(() => addSearchRef.current?.focus());
  }, [addOpen]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserMedications();
      setPinned(data.pinned);
      setRecentlyUsed(data.recentlyUsed);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/medications/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({ results: [] }));
        setResults(res.ok ? (data.results ?? []) : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 150);
    return () => window.clearTimeout(t);
  }, [search]);

  function openEdit(row: UserMedicationRow) {
    setEditRow(row);
    setEditDose(row.defaultDose ?? '');
    setEditUnit(row.defaultUnit ?? '');
    setEditUnitIsCustom(row.defaultUnitIsCustom ?? false);
    setEditOpen(true);
  }

  async function togglePin(row: UserMedicationRow) {
    const next = !row.isPinned;
    // optimistic
    setPinned((prev) => {
      if (next) {
        return [{ ...row, isPinned: true }, ...prev.filter(x => x.id !== row.id)];
      }
      return prev.filter(x => x.id !== row.id);
    });
    setRecentlyUsed(prev => prev.map(x => (x.id === row.id ? { ...x, isPinned: next } : x)));

    try {
      await patchUserMedication(row.id, { isPinned: next });
      showSnackbar({ message: next ? 'Pinned' : 'Unpinned' });
      refresh();
    } catch (e: any) {
      showSnackbar({ message: e.message || 'Failed' });
      refresh();
    }
  }

  async function saveDefaults() {
    if (!editRow) {
      return;
    }
    setSaving(true);
    try {
      await patchUserMedication(editRow.id, {
        defaultDose: editDose.trim() ? editDose.trim() : null,
        defaultUnit: editUnit.trim() ? editUnit.trim() : null,
        defaultUnitIsCustom: editUnitIsCustom,
      });
      showSnackbar({ message: 'Saved' });
      setEditOpen(false);
      refresh();
    } catch (e: any) {
      showSnackbar({ message: e.message || 'Failed' });
    } finally {
      setSaving(false);
    }
  }

  async function onAddFromResult(r: SearchResult) {
    try {
      if (r.kind === 'user') {
        openEdit({
          id: r.userMedicationId,
          label: r.label,
          defaultDose: r.defaultDose,
          defaultUnit: r.defaultUnit,
          defaultUnitIsCustom: r.defaultUnitIsCustom,
          isPinned: r.isPinned,
        });
        setAddOpen(false);
        return;
      }

      const created = await createUserMedication({ catalogMedicationId: r.catalogMedicationId });
      setAddOpen(false);
      await refresh();
      openEdit({
        id: created.userMedicationId,
        label: r.label,
        defaultDose: null,
        defaultUnit: null,
        defaultUnitIsCustom: false,
        isPinned: false,
      });
    } catch (e: any) {
      showSnackbar({ message: e.message || 'Failed' });
    }
  }

  async function onAddCustom(name: string) {
    try {
      const created = await createUserMedication({ customName: name });
      setAddOpen(false);
      await refresh();
      openEdit({
        id: created.userMedicationId,
        label: name,
        defaultDose: null,
        defaultUnit: null,
        defaultUnitIsCustom: false,
        isPinned: false,
      });
    } catch (e: any) {
      showSnackbar({ message: e.message || 'Failed' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-11 pl-9"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search your medications…"
        />
      </div>

      {loading && (
        <div className="space-y-2">
          <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
        </div>
      )}
      {!loading && error && <div className="text-sm text-destructive">{error}</div>}

      {!loading && !error && (
        <div className="space-y-6">
          {/* Pinned */}
          <section>
            <div className="mb-2 text-sm font-semibold">Pinned</div>
            {pinned.length === 0
              ? <div className="text-sm text-muted-foreground">No pinned medications yet.</div>
              : (
                  <div className="space-y-2">
                    {pinned.map((m) => {
                      const suffix = [m.defaultDose, m.defaultUnit].filter(Boolean).join(' ');
                      return (
                        <div key={m.id} className="flex items-center gap-2 rounded-md border bg-background p-3">
                          <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => openEdit(m)}>
                            <div className="truncate font-medium">{m.label}</div>
                            {suffix && <div className="text-sm text-muted-foreground">{suffix}</div>}
                          </button>
                          <button
                            type="button"
                            className="flex size-11 items-center justify-center rounded-md hover:bg-muted"
                            aria-label={m.isPinned ? 'Unpin' : 'Pin'}
                            onClick={() => togglePin(m)}
                          >
                            <Pin className="size-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
          </section>

          {/* Recently used */}
          <section>
            <div className="mb-2 text-sm font-semibold">Recently used (90 days)</div>
            {recentlyUsed.length === 0
              ? <div className="text-sm text-muted-foreground">No recent intakes yet.</div>
              : (
                  <div className="space-y-2">
                    {recentlyUsed.map((m) => {
                      const suffix = [m.defaultDose, m.defaultUnit].filter(Boolean).join(' ');
                      return (
                        <div key={m.id} className="flex items-center gap-2 rounded-md border bg-background p-3">
                          <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => openEdit(m)}>
                            <div className="truncate font-medium">{m.label}</div>
                            {suffix && <div className="text-sm text-muted-foreground">{suffix}</div>}
                          </button>
                          <button
                            type="button"
                            className="flex size-11 items-center justify-center rounded-md hover:bg-muted"
                            aria-label={m.isPinned ? 'Unpin' : 'Pin'}
                            onClick={() => togglePin(m)}
                          >
                            <Pin className="size-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
          </section>
        </div>
      )}

      {/* Fixed bottom add button */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/80 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-screen-xl">
          <Button type="button" className="h-12 w-full" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 size-4" />
            Add medication
          </Button>
        </div>
      </div>

      {/* Add medication sheet */}
      <BottomSheet open={addOpen} onOpenChange={setAddOpen} title="Add medication">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={addSearchRef}
              className="h-11 pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search catalog or your meds"
            />
          </div>

          <div className="text-xs text-muted-foreground">
            {searching ? 'Searching…' : 'Tap to add'}
          </div>

          <div className="space-y-2">
            {results.map(r => (
              <button
                type="button"
                key={r.kind === 'user' ? `u:${r.userMedicationId}` : `c:${r.catalogMedicationId}`}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm hover:bg-muted"
                onClick={() => onAddFromResult(r)}
              >
                <span className="min-w-0 truncate font-medium">{r.label}</span>
                <span className="shrink-0 text-muted-foreground">
                  {r.kind === 'user' ? 'Yours' : 'Catalog'}
                </span>
              </button>
            ))}

            {search.trim() && (
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-dashed bg-background px-3 text-left text-sm hover:bg-muted"
                onClick={() => onAddCustom(search.trim())}
              >
                <span className="min-w-0 truncate font-medium">
                  Add custom “
                  {search.trim()}
                  ”
                </span>
                <span className="shrink-0 text-muted-foreground">Custom</span>
              </button>
            )}
          </div>
        </div>
      </BottomSheet>

      {/* Edit defaults sheet */}
      <BottomSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        title={editRow ? `Medication • ${editRow.label}` : 'Medication'}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
            <div className="text-sm font-medium">Pinned</div>
            <button
              type="button"
              className="min-h-11 rounded-md px-3 text-sm font-medium text-primary hover:bg-muted"
              onClick={() => editRow && togglePin(editRow)}
            >
              {editRow?.isPinned ? 'Unpin' : 'Pin'}
            </button>
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">Default dose (optional)</div>
            <Input className="h-11" value={editDose} onChange={e => setEditDose(e.target.value)} />
          </div>

          <div>
            <div className="mb-1 text-sm font-medium">Default unit (optional)</div>
            <select
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={editUnitIsCustom ? '__custom__' : (editUnit || '')}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__custom__') {
                  setEditUnitIsCustom(true);
                  setEditUnit('');
                } else {
                  setEditUnitIsCustom(false);
                  setEditUnit(v);
                }
              }}
            >
              <option value="">No unit</option>
              {DoseUnitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              <option value="__custom__">Custom…</option>
            </select>
            {editUnitIsCustom && (
              <Input
                className="mt-2 h-11"
                value={editUnit}
                onChange={e => setEditUnit(e.target.value)}
                placeholder="Custom unit"
              />
            )}
          </div>

          <Button className="h-12 w-full" onClick={saveDefaults} disabled={saving || !editRow}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
