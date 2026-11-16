import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { doctorVerificationFileStorage } from '@/services/DoctorVerificationFileStorage';
import { doctorVerificationService } from '@/services/DoctorVerificationService';

// POST /api/doctor-verification/upload - upload or replace a single document (applicant only)
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const app = await doctorVerificationService.getLatestForUser(userId);
  if (!app) {
    return NextResponse.json(
      { error: 'Create an application draft first.', code: 'NO_APPLICATION' },
      { status: 400 },
    );
  }

  if (app.status !== 'pending') {
    return NextResponse.json(
      { error: 'Uploads are only allowed while application is pending.', code: 'INVALID_STATUS' },
      { status: 409 },
    );
  }

  if (app.verificationMethod !== 'document_upload') {
    return NextResponse.json(
      { error: 'This application does not use document upload.', code: 'METHOD_MISMATCH' },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Invalid multipart/form-data', code: 'INVALID_MULTIPART' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing file field', code: 'MISSING_FILE' },
      { status: 400 },
    );
  }

  try {
    const saved = await doctorVerificationFileStorage.replaceSingleFile({
      applicationId: app.id,
      file,
    });

    return NextResponse.json({
      file: {
        id: saved.id,
        applicationId: saved.applicationId,
        originalName: saved.originalName,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        createdAt: saved.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN';

    if (code === 'FILES_STORAGE_PATH_NOT_CONFIGURED') {
      return NextResponse.json(
        { error: 'File storage is not configured.', code },
        { status: 500 },
      );
    }

    if (code === 'FILE_TOO_LARGE') {
      return NextResponse.json(
        { error: 'File too large (max 1MB).', code },
        { status: 413 },
      );
    }

    if (code === 'INVALID_MIME_TYPE') {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: PDF, JPG, PNG.', code },
        { status: 415 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to upload file', code },
      { status: 500 },
    );
  }
}
