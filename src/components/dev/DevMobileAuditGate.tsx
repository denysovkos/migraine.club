'use client';

import { useSearchParams } from 'next/navigation';
import React, { useMemo } from 'react';

import { MobileFirstAudit } from '@/components/dev/MobileFirstAudit';

function parseBool(v: string | null) {
  if (!v) {
    return false;
  }
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes' || v.toLowerCase() === 'on';
}

function parseIntSafe(v: string | null) {
  if (!v) {
    return null;
  }
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

function parseMode(v: string | null): 'highlight' | 'warn' | 'throw' | null {
  if (!v) {
    return null;
  }
  const m = v.toLowerCase();
  if (m === 'highlight' || m === 'warn' || m === 'throw') {
    return m;
  }
  return null;
}

export function DevMobileAuditGate(props: { children: React.ReactNode }) {
  // IMPORTANT: avoid `useSearchParams()` in production builds.
  // If this hook is present in the rendered tree during prerender/export,
  // Next.js requires a Suspense boundary and may bail out to CSR.
  if (process.env.NODE_ENV === 'production') {
    return props.children;
  }

  return <DevMobileAuditGateDev>{props.children}</DevMobileAuditGateDev>;
}

function DevMobileAuditGateDev(props: { children: React.ReactNode }) {
  const sp = useSearchParams();

  const enabledFromEnv = process.env.NEXT_PUBLIC_MOBILE_AUDIT === '1';
  const enabledFromQuery = parseBool(sp.get('mobileAudit'));

  const widthFromQuery = parseIntSafe(sp.get('mobileWidth'));
  const modeFromQuery = parseMode(sp.get('mobileAuditMode'));
  const modeFromEnv = parseMode(process.env.NEXT_PUBLIC_MOBILE_AUDIT_MODE ?? null);

  const enabled = enabledFromEnv || enabledFromQuery;
  const viewportWidth = widthFromQuery ?? null;
  const mode = modeFromQuery ?? modeFromEnv ?? 'highlight';

  const ignoreSelectors = useMemo(() => {
    // Safe defaults; callers can extend later if needed.
    return ['canvas.mapboxgl-canvas'];
  }, []);

  // If neither harness nor audit is enabled, bail out early (avoid observers + overlay in dev).
  if (!enabled && !viewportWidth) {
    return props.children;
  }

  return (
    <MobileFirstAudit
      enabled={enabled}
      mode={mode}
      viewportWidth={viewportWidth ?? undefined}
      ignoreSelectors={ignoreSelectors}
    >
      {props.children}
    </MobileFirstAudit>
  );
}
