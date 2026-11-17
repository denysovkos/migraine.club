import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logger } from '@/libs/Logger';
import {
  buildCsvArchive,
  collectUserData,
  countRows,
  exportFileBaseName,
  serializeJsonExport,
} from '@/services/dataExport/DataExportService';

const FormatSchema = z.enum(['json', 'csv']).default('json');

// GET /api/user/export?format=json|csv - Download a copy of all personal data.
// json: one file with every record. csv: a ZIP with one CSV per record type.
export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedFormat = FormatSchema.safeParse(
    new URL(request.url).searchParams.get('format') ?? undefined,
  );
  if (!parsedFormat.success) {
    return NextResponse.json({ error: 'Invalid format. Use json or csv.' }, { status: 400 });
  }
  const format = parsedFormat.data;

  try {
    const now = new Date();
    const data = await collectUserData(userId, now);
    const baseName = exportFileBaseName(now);

    // IDs and coarse counts only: never log exported content.
    logger.info({ userId, format, rows: countRows(data) }, 'User data export generated');

    const headers = {
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    };

    if (format === 'csv') {
      const archive = buildCsvArchive(data);
      return new Response(archive as Uint8Array<ArrayBuffer>, {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${baseName}-csv.zip"`,
        },
      });
    }

    return new Response(serializeJsonExport(data), {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}.json"`,
      },
    });
  } catch (error) {
    logger.error({ userId, error }, 'Error generating user data export');
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}
