import type { DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import type { ClinicianReportModel } from '@/services/reports/clinician/model';

import { Settings } from 'luxon';
import { createElement } from 'react';

const MIN_NON_EMPTY_PDF_BYTES = 1200;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Renders the document the way the server did: its clock in UTC and its
 * luxon locale (the PDF prints "Generated on" times and month names).
 */
async function withServerFormatting<T>(fn: () => Promise<T>): Promise<T> {
  const zone = Settings.defaultZone;
  const locale = Settings.defaultLocale;
  Settings.defaultZone = 'UTC';
  Settings.defaultLocale = 'en-US';
  try {
    return await fn();
  } finally {
    Settings.defaultZone = zone;
    Settings.defaultLocale = locale;
  }
}

/** The PDF bytes of a model, as renderClinicianReportPdf produced them. */
export async function renderClinicianReportPdfBlob(model: ClinicianReportModel): Promise<Blob> {
  const [{ pdf }, { ClinicianReportPdfDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/services/reports/clinician/renderPdf'),
  ]);
  const document = createElement(ClinicianReportPdfDocument, { model }) as unknown as ReactElement<DocumentProps>;
  return withServerFormatting(() => pdf(document).toBlob());
}

/**
 * What POST /api/reports/clinician/pdf answered, built in the browser: the
 * model comes from the API, the PDF is rendered here.
 */
export async function requestClinicianReportPdf(config: unknown): Promise<Response> {
  const res = await fetch('/api/reports/clinician/model', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    return res;
  }
  try {
    const blob = await renderClinicianReportPdfBlob((await res.json()) as ClinicianReportModel);
    const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
    if (blob.size <= MIN_NON_EMPTY_PDF_BYTES || head !== '%PDF-') {
      return json({ error: 'PDF_GENERATION_EMPTY', message: 'Generated PDF appears empty.' }, 500);
    }
    return new Response(blob, { status: 200, headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
  } catch {
    return json({ error: 'PDF_GENERATION_FAILED' }, 500);
  }
}
