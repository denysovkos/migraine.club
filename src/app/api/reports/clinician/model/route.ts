import { auth } from '@clerk/nextjs/server';
import { ZodError } from 'zod';

import { clinicianReportConfigSchema } from '@/services/reports/clinician/config';
import { getClinicianReportModel } from '@/services/reports/clinician/model';

export const runtime = 'nodejs';

/**
 * The clinician report model for a config: what the browser renders the PDF
 * from (src/features/reports/clinician/clinicianPdf.ts). Errors match the
 * old PDF route's.
 */
export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const config = clinicianReportConfigSchema.parse(body ?? {});
    const model = await getClinicianReportModel(userId, config);
    return new Response(JSON.stringify(model), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
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
    return new Response(JSON.stringify({ error: 'PDF_GENERATION_FAILED' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
