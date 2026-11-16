import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  doctorVerificationApplicationSchema,
  DoctorVerificationApplicationStatus,
  doctorVerificationFileSchema,
  UserRole,
  userSchema,
} from '@/models/Schema';

export type DoctorVerificationApplicationWithFile
  = (typeof doctorVerificationApplicationSchema.$inferSelect) & {
    file: (typeof doctorVerificationFileSchema.$inferSelect) | null;
  };

export class DoctorVerificationService {
  async getLatestForUser(userId: string): Promise<DoctorVerificationApplicationWithFile | null> {
    const [app] = await db
      .select()
      .from(doctorVerificationApplicationSchema)
      .where(eq(doctorVerificationApplicationSchema.userId, userId))
      .orderBy(desc(doctorVerificationApplicationSchema.createdAt))
      .limit(1);

    if (!app) {
      return null;
    }

    const [file] = await db
      .select()
      .from(doctorVerificationFileSchema)
      .where(eq(doctorVerificationFileSchema.applicationId, app.id))
      .limit(1);

    return { ...app, file: file ?? null };
  }

  /**
   * Create or update a draft (no role change, no submittedAt unless already present).
   * Only allowed if latest application is not approved.
   */
  async saveDraft(
    userId: string,
    input: Partial<typeof doctorVerificationApplicationSchema.$inferInsert> & {
      fullName?: string;
      country?: string;
      specialty?: any;
      verificationMethod?: any;
      licenseNumber?: string | null;
      clinicEmail?: string | null;
      applicantStatementAccepted?: boolean;
    },
    options?: { allowCreateIfRejected?: boolean },
  ): Promise<DoctorVerificationApplicationWithFile> {
    const latest = await this.getLatestForUser(userId);

    if (latest?.status === DoctorVerificationApplicationStatus.APPROVED) {
      throw new Error('APPLICATION_APPROVED_LOCKED');
    }

    // If latest is rejected, only create a new draft when explicitly allowed (keeps history).
    const shouldCreateNew = !latest
      || (latest.status === DoctorVerificationApplicationStatus.REJECTED
        && options?.allowCreateIfRejected === true);

    if (shouldCreateNew) {
      const [created] = await db
        .insert(doctorVerificationApplicationSchema)
        .values({
          userId,
          status: DoctorVerificationApplicationStatus.PENDING,
          fullName: input.fullName ?? '',
          country: input.country ?? '',
          specialty: input.specialty ?? 'other',
          verificationMethod: input.verificationMethod ?? 'license_number',
          licenseNumber: input.licenseNumber ?? null,
          clinicEmail: input.clinicEmail ?? null,
          applicantStatementAccepted: input.applicantStatementAccepted ?? false,
          submittedAt: null,
        })
        .returning();

      if (!created) {
        throw new Error('FAILED_TO_CREATE_DRAFT');
      }

      return { ...created, file: null };
    }

    if (!latest) {
      throw new Error('NO_APPLICATION');
    }

    if (latest.status === DoctorVerificationApplicationStatus.REJECTED) {
      throw new Error('APPLICATION_REJECTED_LOCKED');
    }

    const [updated] = await db
      .update(doctorVerificationApplicationSchema)
      .set({
        ...('fullName' in input ? { fullName: input.fullName } : {}),
        ...('country' in input ? { country: input.country } : {}),
        ...('specialty' in input ? { specialty: input.specialty } : {}),
        ...('verificationMethod' in input ? { verificationMethod: input.verificationMethod } : {}),
        ...('licenseNumber' in input ? { licenseNumber: input.licenseNumber ?? null } : {}),
        ...('clinicEmail' in input ? { clinicEmail: input.clinicEmail ?? null } : {}),
        ...('applicantStatementAccepted' in input
          ? { applicantStatementAccepted: input.applicantStatementAccepted ?? false }
          : {}),
        // Never mutate status here; draft editing keeps it pending.
      })
      .where(eq(doctorVerificationApplicationSchema.id, latest.id))
      .returning();

    if (!updated) {
      throw new Error('FAILED_TO_UPDATE_DRAFT');
    }

    const [file] = await db
      .select()
      .from(doctorVerificationFileSchema)
      .where(eq(doctorVerificationFileSchema.applicationId, updated.id))
      .limit(1);

    return { ...updated, file: file ?? null };
  }

  /**
   * Submit an application for review:
   * - status=pending
   * - submittedAt=now
   * - user.role=doctor_pending
   */
  async submitApplication(params: {
    userId: string;
    applicationId: string;
  }): Promise<DoctorVerificationApplicationWithFile> {
    const now = new Date();

    const [submitted] = await db
      .update(doctorVerificationApplicationSchema)
      .set({
        status: DoctorVerificationApplicationStatus.PENDING,
        submittedAt: now,
      })
      .where(
        and(
          eq(doctorVerificationApplicationSchema.id, params.applicationId),
          eq(doctorVerificationApplicationSchema.userId, params.userId),
        ),
      )
      .returning();

    if (!submitted) {
      throw new Error('FAILED_TO_SUBMIT');
    }

    await db
      .update(userSchema)
      .set({
        role: UserRole.DOCTOR_PENDING,
        // Keep legacy flags in sync for backwards compatibility
        isDoctor: true,
        isDoctorVerified: false,
      })
      .where(eq(userSchema.id, params.userId));

    const [file] = await db
      .select()
      .from(doctorVerificationFileSchema)
      .where(eq(doctorVerificationFileSchema.applicationId, submitted.id))
      .limit(1);

    return { ...submitted, file: file ?? null };
  }

  async getForAdmin(applicationId: string): Promise<DoctorVerificationApplicationWithFile | null> {
    const [app] = await db
      .select()
      .from(doctorVerificationApplicationSchema)
      .where(eq(doctorVerificationApplicationSchema.id, applicationId))
      .limit(1);

    if (!app) {
      return null;
    }

    const [file] = await db
      .select()
      .from(doctorVerificationFileSchema)
      .where(eq(doctorVerificationFileSchema.applicationId, app.id))
      .limit(1);

    return { ...app, file: file ?? null };
  }

  async approveAdmin(params: {
    applicationId: string;
    adminUserId: string;
    adminNotes?: string | null;
    userFacingNote?: string | null;
  }) {
    const app = await this.getForAdmin(params.applicationId);
    if (!app) {
      throw new Error('NOT_FOUND');
    }

    const now = new Date();

    await db
      .update(doctorVerificationApplicationSchema)
      .set({
        status: DoctorVerificationApplicationStatus.APPROVED,
        reviewedAt: now,
        reviewedByAdminId: params.adminUserId,
        adminNotes: params.adminNotes ?? null,
        userFacingNote: params.userFacingNote ?? null,
      })
      .where(eq(doctorVerificationApplicationSchema.id, app.id));

    await db
      .update(userSchema)
      .set({
        role: UserRole.DOCTOR_VERIFIED,
        isDoctor: true,
        isDoctorVerified: true,
      })
      .where(eq(userSchema.id, app.userId));

    logger.info(
      { applicationId: app.id, userId: app.userId, adminUserId: params.adminUserId },
      'Doctor verification approved',
    );
  }

  async rejectAdmin(params: {
    applicationId: string;
    adminUserId: string;
    reason: string;
    adminNotes?: string | null;
    userFacingNote?: string | null;
  }) {
    const app = await this.getForAdmin(params.applicationId);
    if (!app) {
      throw new Error('NOT_FOUND');
    }

    const now = new Date();

    await db
      .update(doctorVerificationApplicationSchema)
      .set({
        status: DoctorVerificationApplicationStatus.REJECTED,
        reviewedAt: now,
        reviewedByAdminId: params.adminUserId,
        adminNotes: params.adminNotes ?? params.reason,
        userFacingNote: params.userFacingNote ?? null,
      })
      .where(eq(doctorVerificationApplicationSchema.id, app.id));

    await db
      .update(userSchema)
      .set({
        role: UserRole.DOCTOR_REJECTED,
        isDoctor: true,
        isDoctorVerified: false,
      })
      .where(eq(userSchema.id, app.userId));

    logger.info(
      { applicationId: app.id, userId: app.userId, adminUserId: params.adminUserId },
      'Doctor verification rejected',
    );
  }
}

export const doctorVerificationService = new DoctorVerificationService();
