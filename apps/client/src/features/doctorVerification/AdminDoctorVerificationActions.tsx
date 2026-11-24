'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function AdminDoctorVerificationActions(props: { applicationId: string }) {
  const [reason, setReason] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [userFacingNote, setUserFacingNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function approve() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/admin/doctor-verification/applications/${props.applicationId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNotes: adminNotes || null, userFacingNote: userFacingNote || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Approve failed');
      }
      setSuccess('Approved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setLoading(false);
    }
  }

  async function reject() {
    if (!reason.trim()) {
      setError('Reject reason is required.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/admin/doctor-verification/applications/${props.applicationId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          adminNotes: adminNotes || null,
          userFacingNote: userFacingNote || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Reject failed');
      }
      setSuccess('Rejected');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 text-sm font-medium">Review decision</div>

      <div className="space-y-3">
        <div className="grid gap-1">
          <label htmlFor="reason" className="text-xs font-medium text-muted-foreground">Reject reason (required)</label>
          <input
            id="reason"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Short internal reason"
            disabled={loading}
          />
        </div>

        <div className="grid gap-1">
          <label htmlFor="reason-admin-notes" className="text-xs font-medium text-muted-foreground">Admin notes (internal)</label>
          <textarea
            id="reason-admin-notes"
            className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={adminNotes}
            onChange={e => setAdminNotes(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="grid gap-1">
          <label htmlFor="reason-user-facing-notes" className="text-xs font-medium text-muted-foreground">User-facing note (optional)</label>
          <textarea
            id="reason-user-facing-notes"
            className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={userFacingNote}
            onChange={e => setUserFacingNote(e.target.value)}
            disabled={loading}
          />
        </div>

        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md bg-emerald-500/15 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            {success}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="min-h-[44px]"
            onClick={approve}
            disabled={loading}
          >
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Approve
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-[44px]"
            onClick={reject}
            disabled={loading}
          >
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
