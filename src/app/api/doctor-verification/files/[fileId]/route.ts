import type { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';

import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { doctorVerificationApplicationSchema, doctorVerificationFileSchema } from '@/models/Schema';

// GET /api/doctor-verification/files/:fileId - applicant-only download
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fileId } = await params;

  const [file] = await db
    .select()
    .from(doctorVerificationFileSchema)
    .where(eq(doctorVerificationFileSchema.id, fileId))
    .limit(1);

  if (!file) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [app] = await db
    .select()
    .from(doctorVerificationApplicationSchema)
    .where(eq(doctorVerificationApplicationSchema.id, file.applicationId))
    .limit(1);

  if (!app || app.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const base = Env.FILES_STORAGE_PATH;
  if (!base) {
    return NextResponse.json(
      { error: 'File storage is not configured' },
      { status: 500 },
    );
  }

  const absolutePath = path.join(base, file.relativePath);

  let data: Buffer;
  try {
    data = await fs.readFile(absolutePath);
  } catch {
    return NextResponse.json({ error: 'File missing on server' }, { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', file.mimeType);
  headers.set('Content-Disposition', `attachment; filename="${file.originalName}"`);
  headers.set('X-Content-Type-Options', 'nosniff');

  return new NextResponse(new Blob([new Uint8Array(data)]), { status: 200, headers });
}
