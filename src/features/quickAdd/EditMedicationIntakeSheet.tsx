'use client';

import { useEffect, useMemo, useState } from 'react';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { quickAddUpdateIntake } from '@/features/quickAdd/quickAddApi';
import { DoseUnitOptions } from '@/types/Medications';

function toLocalDateParts(date: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function EditMedicationIntakeSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intakeId: string | null;
  label: string;
  initialDose: string | null;
  initialUnit: string | null;
  initialUnitIsCustom: boolean;
  initialTakenAt?: Date | null;
  onSaved?: () => void;
}) {
  const [dose, setDose] = useState(props.initialDose ?? '');
  const [unit, setUnit] = useState(props.initialUnit ?? '');
  const [unitIsCustom, setUnitIsCustom] = useState(props.initialUnitIsCustom);
  const [takenAtDate, setTakenAtDate] = useState(() => {
    const { date } = toLocalDateParts(props.initialTakenAt ?? new Date());
    return date;
  });
  const [takenAtTime, setTakenAtTime] = useState(() => {
    const { time } = toLocalDateParts(props.initialTakenAt ?? new Date());
    return time;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitOptions = useMemo(() => DoseUnitOptions, []);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setDose(props.initialDose ?? '');
    setUnit(props.initialUnit ?? '');
    setUnitIsCustom(props.initialUnitIsCustom);
    const { date, time } = toLocalDateParts(props.initialTakenAt ?? new Date());
    setTakenAtDate(date);
    setTakenAtTime(time);
    setError(null);
  }, [props.open, props.initialDose, props.initialUnit, props.initialUnitIsCustom, props.initialTakenAt, props.intakeId]);

  async function onSave() {
    if (!props.intakeId) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const takenAtIso = takenAtDate && takenAtTime
        ? new Date(`${takenAtDate}T${takenAtTime}`).toISOString()
        : null;
      await quickAddUpdateIntake(props.intakeId, {
        dose: dose.trim() ? dose.trim() : null,
        unit: unit.trim() ? unit.trim() : null,
        unitIsCustom,
        takenAt: takenAtIso,
      });
      props.onSaved?.();
      props.onOpenChange(false);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`Edit • ${props.label}`}
    >
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-sm font-medium">Time taken</div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={takenAtDate}
              max={toLocalDateParts(new Date()).date}
              onChange={e => setTakenAtDate(e.target.value)}
            />
            <input
              type="time"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={takenAtTime}
              onChange={e => setTakenAtTime(e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="mb-1 text-sm font-medium">Dose (optional)</div>
          <Input
            value={dose}
            onChange={e => setDose(e.target.value)}
            placeholder="e.g. 50"
            className="h-11"
          />
        </div>

        <div>
          <div className="mb-1 text-sm font-medium">Unit (optional)</div>
          <div className="flex gap-2">
            <select
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={unitIsCustom ? '__custom__' : (unit || '')}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__custom__') {
                  setUnitIsCustom(true);
                  setUnit('');
                } else {
                  setUnitIsCustom(false);
                  setUnit(v);
                }
              }}
            >
              <option value="">No unit</option>
              {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              <option value="__custom__">Custom…</option>
            </select>
          </div>

          {unitIsCustom && (
            <Input
              value={unit}
              onChange={e => setUnit(e.target.value)}
              placeholder="Custom unit"
              className="mt-2 h-11"
            />
          )}
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        <Button className="h-11 w-full" onClick={onSave} disabled={saving || !props.intakeId}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </BottomSheet>
  );
}
