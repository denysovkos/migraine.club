import type { DoctorVerificationApplicationDto } from '@/types/DoctorVerification';
import { auth } from '@clerk/nextjs/server';

import { NextResponse } from 'next/server';
import { doctorVerificationService } from '@/services/DoctorVerificationService';
import {
  DoctorVerificationApplicationDraftSchema,
  DoctorVerificationApplicationSubmitSchema,
} from '@/types/DoctorVerification';

function toDto(app: any): DoctorVerificationApplicationDto {
  return {
    id: app.id,
    userId: app.userId,
    status: app.status,
    fullName: app.fullName,
    country: app.country,
    specialty: app.specialty,
    verificationMethod: app.verificationMethod,
    licenseNumber: app.licenseNumber ?? null,
    clinicEmail: app.clinicEmail ?? null,
    applicantStatementAccepted: !!app.applicantStatementAccepted,
    submittedAt: app.submittedAt ? new Date(app.submittedAt).toISOString() : null,
    reviewedAt: app.reviewedAt ? new Date(app.reviewedAt).toISOString() : null,
    reviewedByAdminId: app.reviewedByAdminId ?? null,
    adminNotes: app.adminNotes ?? null,
    userFacingNote: app.userFacingNote ?? null,
    createdAt: new Date(app.createdAt).toISOString(),
    updatedAt: new Date(app.updatedAt).toISOString(),
    file: app.file
      ? {
          id: app.file.id,
          applicationId: app.file.applicationId,
          originalName: app.file.originalName,
          mimeType: app.file.mimeType,
          sizeBytes: app.file.sizeBytes,
          createdAt: new Date(app.file.createdAt).toISOString(),
        }
      : null,
  };
}

// GET /api/doctor-verification/application - get latest application/draft for the current user
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const app = await doctorVerificationService.getLatestForUser(userId);
  return NextResponse.json({ application: app ? toDto(app) : null });
}

// PUT /api/doctor-verification/application - save draft edits (no submission side-effects)
export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const reapply = searchParams.get('reapply') === 'true';

  const body = await request.json();
  const parsed = DoctorVerificationApplicationDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const app = await doctorVerificationService.saveDraft(userId, {
      ...(parsed.data.fullName !== undefined ? { fullName: parsed.data.fullName } : {}),
      ...(parsed.data.country !== undefined ? { country: parsed.data.country } : {}),
      ...(parsed.data.specialty !== undefined ? { specialty: parsed.data.specialty } : {}),
      ...(parsed.data.verificationMethod !== undefined
        ? { verificationMethod: parsed.data.verificationMethod }
        : {}),
      ...(parsed.data.licenseNumber !== undefined
        ? { licenseNumber: parsed.data.licenseNumber ?? null }
        : {}),
      ...(parsed.data.clinicEmail !== undefined
        ? { clinicEmail: parsed.data.clinicEmail ?? null }
        : {}),
      ...(parsed.data.applicantStatementAccepted !== undefined
        ? { applicantStatementAccepted: parsed.data.applicantStatementAccepted }
        : {}),
    }, { allowCreateIfRejected: reapply });

    return NextResponse.json({ application: toDto(app) });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN';
    if (code === 'APPLICATION_APPROVED_LOCKED') {
      return NextResponse.json(
        { error: 'Application already approved', code },
        { status: 409 },
      );
    }
    if (code === 'APPLICATION_REJECTED_LOCKED') {
      return NextResponse.json(
        { error: 'Application rejected. Please re-apply.', code },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 });
  }
}

// POST /api/doctor-verification/application - submit for review
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = DoctorVerificationApplicationSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const latest = await doctorVerificationService.getLatestForUser(userId);

    if (latest?.status === 'rejected' && parsed.data.reapply !== true) {
      return NextResponse.json(
        { error: 'Rejected application. Please re-apply.', code: 'REAPPLY_REQUIRED' },
        { status: 409 },
      );
    }

    const app = await doctorVerificationService.saveDraft(
      userId,
      {
        fullName: parsed.data.fullName,
        country: parsed.data.country,
        specialty: parsed.data.specialty,
        verificationMethod: parsed.data.verificationMethod,
        licenseNumber: parsed.data.licenseNumber ?? null,
        clinicEmail: parsed.data.clinicEmail ?? null,
        applicantStatementAccepted: parsed.data.applicantStatementAccepted,
      },
      { allowCreateIfRejected: parsed.data.reapply === true },
    );

    if (app.verificationMethod === 'document_upload' && !app.file) {
      return NextResponse.json(
        {
          error: 'Document upload is required for this verification method.',
          code: 'DOCUMENT_REQUIRED',
        },
        { status: 400 },
      );
    }

    const submitted = await doctorVerificationService.submitApplication({
      userId,
      applicationId: app.id,
    });

    return NextResponse.json({ application: toDto(submitted) });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN';
    if (code === 'APPLICATION_APPROVED_LOCKED') {
      return NextResponse.json(
        { error: 'Application already approved', code },
        { status: 409 },
      );
    }
    if (code === 'APPLICATION_REJECTED_LOCKED') {
      return NextResponse.json(
        { error: 'Rejected application. Please re-apply.', code: 'REAPPLY_REQUIRED' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 });
  }
}
