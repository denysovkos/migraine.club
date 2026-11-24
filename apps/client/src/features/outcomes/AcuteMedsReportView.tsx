'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

type ReportResponse = {
  mode: 'rolling30' | 'calendarMonth';
  medications: Array<{
    medicationId: string;
    medicationLabel: string;
    medicationClass: string;
    usageDays: number;
    successRate: number | null;
    medianTimeToReliefMinutes: number | null;
    needingSecondDosePct: number;
  }>;
};

export function AcuteMedsReportView() {
  const [mode, setMode] = useState<'rolling30' | 'calendarMonth'>('rolling30');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReportResponse | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/acute-meds-report?mode=${mode}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          return null;
        }
        return res.json();
      })
      .then(json => setData(json))
      .finally(() => setLoading(false));
  }, [mode]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading report…</div>;
  }

  if (!data || data.medications.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm text-muted-foreground">
          No acute dose data yet. Log a dose from your dashboard quick kit or attack card.
        </div>
        <Button asChild className="mt-3">
          <Link href="/dashboard">Log a dose</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'rolling30' ? 'default' : 'outline'}
          onClick={() => setMode('rolling30')}
        >
          Rolling 30
        </Button>
        <Button
          type="button"
          variant={mode === 'calendarMonth' ? 'default' : 'outline'}
          onClick={() => setMode('calendarMonth')}
        >
          Calendar month
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-3">
        <div className="grid grid-cols-5 gap-2 text-xs font-medium text-muted-foreground">
          <div>Medication</div>
          <div>Usage days</div>
          <div>Success rate</div>
          <div>Median relief</div>
          <div>2nd dose needed</div>
        </div>
        <div className="mt-2 space-y-2">
          {data.medications.map(m => (
            <div key={m.medicationId} className="grid grid-cols-5 gap-2 rounded-md border bg-background p-2 text-sm">
              <div className="min-w-0 truncate">{m.medicationLabel}</div>
              <div>{m.usageDays}</div>
              <div>{m.successRate === null ? '—' : `${Math.round(m.successRate * 100)}%`}</div>
              <div>{m.medianTimeToReliefMinutes === null ? '—' : `${m.medianTimeToReliefMinutes} min`}</div>
              <div>
                {Math.round(m.needingSecondDosePct * 100)}
                %
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
