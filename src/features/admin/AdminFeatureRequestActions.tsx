'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FeatureRequestResolution } from '@/models/Schema';

type Props = {
  requestId: string;
  currentResolution: string;
};

const RESOLUTION_VALUES = [
  FeatureRequestResolution.SENT,
  FeatureRequestResolution.IN_REVIEW,
  FeatureRequestResolution.ACCEPTED,
  FeatureRequestResolution.REJECTED,
] as const;

const resolutionLabelKey = (resolution: string) => {
  switch (resolution) {
    case FeatureRequestResolution.SENT:
      return 'sent';
    case FeatureRequestResolution.IN_REVIEW:
      return 'in_review';
    case FeatureRequestResolution.ACCEPTED:
      return 'accepted';
    case FeatureRequestResolution.REJECTED:
      return 'rejected';
    default:
      return 'sent';
  }
};

export function AdminFeatureRequestActions({ requestId, currentResolution }: Props) {
  const router = useRouter();
  const [resolution, setResolution] = useState(currentResolution);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/feature-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          resolution,
        }),
      });

      if (!response.ok) {
        throw new Error('UPDATE_FAILED');
      }

      router.refresh();
    } catch {
      setError('Failed to update resolution.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={`feature-request-resolution-${requestId}`} className="text-xs text-muted-foreground">
        Resolution
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={`feature-request-resolution-${requestId}`}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={resolution}
          onChange={event => setResolution(event.target.value)}
          disabled={saving}
        >
          {RESOLUTION_VALUES.map(value => (
            <option key={value} value={value}>
              {resolutionLabelKey(value).toUpperCase().replace('_', ' ')}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || resolution === currentResolution}
        >
          {saving
            ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Updating...
                </>
              )
            : (
                'Update resolution'
              )}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
