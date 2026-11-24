import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { reportModelFixture } from '@/services/reports/clinician/modelFixture';

import { requestClinicianReportPdf } from './clinicianPdf';

const realFetch = globalThis.fetch;

/** Answers the model API; everything else (react-pdf's wasm) loads for real. */
function respond(status: number, body: unknown) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/reports/clinician/model') {
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  });
}

describe('requestClinicianReportPdf', () => {
  // react-pdf drives its own reconciler outside React DOM's act() model.
  const act = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = act;
  });

  it('renders the PDF from the model the API returns', async () => {
    const fetchMock = respond(200, reportModelFixture);
    vi.stubGlobal('fetch', fetchMock);

    const res = await requestClinicianReportPdf({ template: 'quick', rangePreset: 'last90' });

    expect(fetchMock).toHaveBeenCalledWith('/api/reports/clinician/model', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ template: 'quick', rangePreset: 'last90' }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const bytes = new Uint8Array(await res.arrayBuffer());

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1200);
  });

  it('passes API errors through unchanged', async () => {
    vi.stubGlobal('fetch', respond(400, { error: 'Invalid config', details: [] }));

    const res = await requestClinicianReportPdf({ template: 'nope' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid config', details: [] });
  });

  it('renders with the server clock settings and restores the browser ones', async () => {
    const { Settings } = await import('luxon');
    Settings.defaultZone = 'Asia/Tokyo';
    vi.stubGlobal('fetch', respond(200, reportModelFixture));

    await requestClinicianReportPdf({});

    expect(Settings.defaultZone.name).toBe('Asia/Tokyo');

    Settings.defaultZone = 'system';
  });
});
