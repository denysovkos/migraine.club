import { auth } from '@clerk/nextjs/server';
import { DateTime } from 'luxon';
import { ZodError } from 'zod';

import { clinicianReportConfigSchema } from '@/services/reports/clinician/config';
import { getClinicianReportModel } from '@/services/reports/clinician/model';
import { renderClinicianReportPdf } from '@/services/reports/clinician/renderPdfBuffer';

const MIN_NON_EMPTY_PDF_BYTES = 1200;

export const runtime = 'nodejs';

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
    const pdf = await renderClinicianReportPdf(model);

    const hasPdfHeader = pdf.subarray(0, 5).toString('utf-8') === '%PDF-';
    if (pdf.byteLength <= MIN_NON_EMPTY_PDF_BYTES || !hasPdfHeader) {
      return new Response(
        JSON.stringify({
          error: 'PDF_GENERATION_EMPTY',
          message: 'Generated PDF appears empty.',
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    const today = DateTime.now().toFormat('yyyy-LL-dd');
    const filename = model.appointmentPrep
      ? `Migrennity_Appointment_Prep_${today}_${model.range.from}_${model.range.to}.pdf`
      : `Migrennity_Clinician_Report_${today}_${model.range.from}_${model.range.to}.pdf`;
    return new Response(new Blob([new Uint8Array(pdf)]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
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
