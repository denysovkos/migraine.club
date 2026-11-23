import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

const getModelMock = vi.fn();
vi.mock('@/services/reports/clinician/model', () => ({
  getClinicianReportModel: getModelMock,
}));

const post = async (body: string) => {
  const mod = await import('./route');
  return mod.POST(new Request('http://localhost/api/reports/clinician/model', { method: 'POST', body }));
};

describe('POST /api/reports/clinician/model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the model for the parsed config', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getModelMock.mockResolvedValue({ range: { from: '2026-01-01', to: '2026-03-31' } });

    const res = await post(JSON.stringify({ template: 'quick', appointmentPrepId: '123e4567-e89b-12d3-a456-426614174000' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ range: { from: '2026-01-01', to: '2026-03-31' } });
    expect(getModelMock).toHaveBeenCalledWith('user-1', expect.objectContaining({ appointmentPrepId: '123e4567-e89b-12d3-a456-426614174000' }));
  });

  it('rejects signed-out callers, bad JSON and bad configs', async () => {
    authMock.mockResolvedValue({ userId: null });

    expect((await post('{}')).status).toBe(401);

    authMock.mockResolvedValue({ userId: 'user-1' });

    expect(await (await post('{')).json()).toEqual({ error: 'Invalid JSON body' });

    const invalid = await post(JSON.stringify({ template: 'nope' }));

    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe('Invalid config');
  });

  it('reports model failures as PDF_GENERATION_FAILED', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' });
    getModelMock.mockRejectedValue(new Error('db down'));

    const res = await post('{}');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'PDF_GENERATION_FAILED' });
  });
});
