import { auth } from '@clerk/nextjs/server';
import { ZodError } from 'zod';

import { clinicianReportConfigSchema } from '@/services/reports/clinician/config';
import { getClinicianReportModel } from '@/services/reports/clinician/model';
import { renderClinicianReportHtml } from '@/services/reports/clinician/renderHtml';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const rawConfig = url.searchParams.get('config');
    const parsed = rawConfig ? JSON.parse(rawConfig) : {};
    const config = clinicianReportConfigSchema.parse(parsed);
    const model = await getClinicianReportModel(userId, config);
    const html = renderClinicianReportHtml(model);
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: 'Invalid config JSON' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (error instanceof ZodError) {
      return new Response(JSON.stringify({ error: 'Invalid config', details: error.issues }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Failed to generate preview' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
