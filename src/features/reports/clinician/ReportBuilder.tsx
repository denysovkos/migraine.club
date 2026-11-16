'use client';

import type { ClinicianReportConfig } from '@/services/reports/clinician/config';
import { DateTime } from 'luxon';
import Link from 'next/link';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  clinicianReportConfigSchema,
} from '@/services/reports/clinician/config';
import { trackEvent } from '@/utils/analytics';

type Step = 1 | 2;

function downloadBlob(args: { blob: Blob; filename: string }) {
  const href = URL.createObjectURL(args.blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = args.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export function ReportBuilder() {
  const [step, setStep] = useState<Step>(1);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [config, setConfig] = useState<ClinicianReportConfig>(() => clinicianReportConfigSchema.parse({
    template: 'quick',
    rangePreset: 'last90',
  }));
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    trackEvent('report_builder_opened');
  }, []);

  const previewUrl = `/api/reports/clinician/preview?config=${encodeURIComponent(JSON.stringify(config))}`;

  const canShareFiles = useMemo(() => {
    if (typeof navigator === 'undefined') {
      return false;
    }
    if (typeof navigator.share !== 'function') {
      return false;
    }
    return typeof (navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare === 'function';
  }, []);

  const generatePreview = async () => {
    setError(null);
    setLoadingPreview(true);
    try {
      const res = await fetch(previewUrl, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('Failed to generate preview');
      }
      const html = await res.text();
      setPreviewHtml(html);
      setStep(2);
      trackEvent('report_preview_generated', { template: config.template });
    } catch {
      setError('Could not generate preview. Please retry.');
      trackEvent('report_generation_failed', { errorCode: 'PREVIEW_FAILED' });
    } finally {
      setLoadingPreview(false);
    }
  };

  const exportPdf = async () => {
    setDownloading(true);
    setError(null);
    setGenerationFailed(false);
    try {
      const res = await fetch('/api/reports/clinician/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'PDF_GENERATION_FAILED');
      }
      const blob = await res.blob();
      setPdfBlob(blob);
      const now = DateTime.now().toFormat('yyyy-LL-dd');
      const rangeSuffix = config.rangePreset === 'custom' && config.from && config.to
        ? `${config.from}_${config.to}`
        : config.rangePreset;
      downloadBlob({
        blob,
        filename: `Migrennity_Clinician_Report_${now}_${rangeSuffix}.pdf`,
      });
      trackEvent('report_pdf_downloaded', { template: config.template });
    } catch (e) {
      setGenerationFailed(true);
      setError('PDF generation failed. Please retry or export HTML.');
      trackEvent('report_generation_failed', {
        errorCode: e instanceof Error ? e.message : 'PDF_FAILED',
      });
    } finally {
      setDownloading(false);
    }
  };

  const sharePdf = async () => {
    if (!pdfBlob || !canShareFiles) {
      return;
    }
    try {
      const file = new File([pdfBlob], 'Migrennity_Clinician_Report.pdf', { type: 'application/pdf' });
      const canShare = (navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare?.({ files: [file] });
      if (!canShare) {
        return;
      }
      await navigator.share({
        title: 'Migrennity Clinician Report',
        files: [file],
      });
      trackEvent('report_shared');
    } catch {
      trackEvent('report_generation_failed', { errorCode: 'SHARE_FAILED' });
    }
  };

  const copyPreviewLink = async () => {
    try {
      const absoluteUrl = new URL(previewUrl, window.location.origin).toString();
      await navigator.clipboard.writeText(absoluteUrl);
    } catch {
      setError('Could not copy preview link.');
    }
  };

  const exportHtmlFallback = () => {
    if (!previewHtml) {
      return;
    }
    downloadBlob({
      blob: new Blob([previewHtml], { type: 'text/html' }),
      filename: 'Migrennity_Clinician_Report.html',
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="text-lg font-semibold">Clinician report builder</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Create a doctor-scannable export from your migraine tracking data.
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className={step === 1 ? 'font-semibold' : 'text-muted-foreground'}>1. Configure</span>
          <span className="text-muted-foreground">-</span>
          <span className={step === 2 ? 'font-semibold' : 'text-muted-foreground'}>2. Preview & export</span>
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="report-template" className="text-xs text-muted-foreground">Template</label>
              <select
                id="report-template"
                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm"
                value={config.template}
                onChange={(e) => {
                  const template = e.target.value as ClinicianReportConfig['template'];
                  setConfig(prev => ({ ...prev, template }));
                  trackEvent('report_template_selected', { template });
                }}
              >
                <option value="quick">Quick (1-2 pages)</option>
                <option value="full">Full (5-10 pages)</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label htmlFor="report-date-range" className="text-xs text-muted-foreground">Date range</label>
              <select
                id="report-date-range"
                className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm"
                value={config.rangePreset}
                onChange={(e) => {
                  const rangePreset = e.target.value as ClinicianReportConfig['rangePreset'];
                  setConfig(prev => ({ ...prev, rangePreset }));
                  trackEvent('report_range_selected', { rangePreset });
                }}
              >
                <option value="last30">Last 30 days</option>
                <option value="last90">Last 90 days</option>
                <option value="last180">Last 180 days</option>
                <option value="custom">Custom range</option>
              </select>
            </div>
          </div>

          {config.rangePreset === 'custom' && (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="report-range-from" className="text-xs text-muted-foreground">From</label>
                <Input
                  id="report-range-from"
                  type="date"
                  value={config.from ?? ''}
                  onChange={e => setConfig(prev => ({ ...prev, from: e.target.value }))}
                  className="mt-1 h-11"
                />
              </div>
              <div>
                <label htmlFor="report-range-to" className="text-xs text-muted-foreground">To</label>
                <Input
                  id="report-range-to"
                  type="date"
                  value={config.to ?? ''}
                  onChange={e => setConfig(prev => ({ ...prev, to: e.target.value }))}
                  className="mt-1 h-11"
                />
              </div>
            </div>
          )}

          {config.template === 'custom' && (
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Sections</div>
              <div className="grid gap-2 md:grid-cols-2">
                {Object.keys(config.sections).map(key => (
                  <label key={key} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.sections[key as keyof ClinicianReportConfig['sections']]}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        sections: {
                          ...prev.sections,
                          [key]: e.target.checked,
                        },
                      }))}
                    />
                    {key}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={loadingPreview} onClick={generatePreview}>
              {loadingPreview ? 'Generating preview...' : 'Continue to preview'}
            </Button>
            <Button variant="outline" asChild className="min-h-11">
              <Link href="/dashboard/reports">Back to reports</Link>
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <Button onClick={exportPdf} disabled={downloading} className="min-h-11">
                {downloading ? 'Preparing PDF...' : 'Download PDF'}
              </Button>
              {canShareFiles && pdfBlob && (
                <Button variant="outline" onClick={sharePdf} className="min-h-11">
                  Share
                </Button>
              )}
              {!canShareFiles && (
                <Button variant="outline" onClick={copyPreviewLink} className="min-h-11">
                  Copy download link
                </Button>
              )}
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => iframeRef.current?.contentWindow?.print()}
              >
                Print
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => setStep(1)}>
                Edit configuration
              </Button>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
                {generationFailed && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={exportPdf}>
                      Retry
                    </Button>
                    <Button size="sm" variant="outline" onClick={exportHtmlFallback}>
                      Export HTML
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card p-2">
            <iframe
              ref={iframeRef}
              title="Clinician report preview"
              srcDoc={previewHtml}
              className="h-[70vh] w-full rounded-md border bg-white"
              sandbox="allow-downloads allow-modals allow-same-origin"
            />
          </div>
        </div>
      )}
    </div>
  );
}
