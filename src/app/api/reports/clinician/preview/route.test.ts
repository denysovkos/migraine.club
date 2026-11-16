import { describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const getModelMock = vi.fn();
vi.mock('@/services/reports/clinician/model', () => ({
  getClinicianReportModel: getModelMock,
}));

const renderHtmlMock = vi.fn();
vi.mock('@/services/reports/clinician/renderHtml', () => ({
  renderClinicianReportHtml: renderHtmlMock,
}));

describe('GET /api/reports/clinician/preview', () => {
  it('passes appointmentPrepId through to the clinician report model', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getModelMock.mockResolvedValue({
      title: 'Migrennity Clinician Report',
      sections: ['summary'],
    });
    renderHtmlMock.mockReturnValue('<html><body><h1>Migrennity Clinician Report</h1></body></html>');

    const mod = await import('./route');
    await mod.GET(
      new Request('http://localhost/api/reports/clinician/preview?config=%7B%22appointmentPrepId%22%3A%22123e4567-e89b-12d3-a456-426614174000%22%7D'),
    );

    expect(getModelMock).toHaveBeenCalledWith('user-1', expect.objectContaining({
      appointmentPrepId: '123e4567-e89b-12d3-a456-426614174000',
    }));
  });

  it('renders expected sections as HTML', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getModelMock.mockResolvedValue({
      title: 'Migrennity Clinician Report',
      sections: ['summary', 'attacks'],
    });
    renderHtmlMock.mockReturnValue('<html><body><h1>Migrennity Clinician Report</h1><h2>Summary</h2><h2>Attacks</h2></body></html>');

    const mod = await import('./route');
    const res = await mod.GET(new Request('http://localhost/api/reports/clinician/preview?config={}'));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Summary');
    expect(html).toContain('Attacks');
  });
});
