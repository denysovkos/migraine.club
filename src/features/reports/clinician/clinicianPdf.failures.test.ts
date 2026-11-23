import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportModelFixture } from '@/services/reports/clinician/modelFixture';

import { requestClinicianReportPdf } from './clinicianPdf';

const toBlob = vi.fn();
vi.mock('@react-pdf/renderer', async importOriginal => ({
  ...(await importOriginal<typeof import('@react-pdf/renderer')>()),
  pdf: () => ({ toBlob }),
}));

describe('requestClinicianReportPdf when rendering goes wrong', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a render failure as PDF_GENERATION_FAILED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(reportModelFixture)));
    toBlob.mockRejectedValue(new Error('boom'));

    const res = await requestClinicianReportPdf({});

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'PDF_GENERATION_FAILED' });
  });

  it('refuses an empty document as the server did', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(reportModelFixture)));
    toBlob.mockResolvedValue(new Blob(['%PDF-1.7 tiny']));

    const res = await requestClinicianReportPdf({});

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'PDF_GENERATION_EMPTY', message: 'Generated PDF appears empty.' });
  });
});
