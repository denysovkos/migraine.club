import { z } from 'zod';

export const DoctorVerificationSpecialtyEnum = z.enum([
  'neurologist',
  'gp',
  'pain_specialist',
  'other',
]);

export type DoctorVerificationSpecialty = z.infer<typeof DoctorVerificationSpecialtyEnum>;

export const DoctorVerificationMethodEnum = z.enum([
  'license_number',
  'clinic_email',
  'document_upload',
]);

export type DoctorVerificationMethod = z.infer<typeof DoctorVerificationMethodEnum>;

export const DoctorVerificationApplicationStatusEnum = z.enum([
  'pending',
  'approved',
  'rejected',
  'revoked',
]);

export type DoctorVerificationApplicationStatus = z.infer<
  typeof DoctorVerificationApplicationStatusEnum
>;

const baseFields = {
  fullName: z.string().min(2).max(200),
  country: z.string().min(2).max(64),
  specialty: DoctorVerificationSpecialtyEnum,
  verificationMethod: DoctorVerificationMethodEnum,
  applicantStatementAccepted: z.boolean(),
  licenseNumber: z.string().min(2).max(128).optional().nullable(),
  clinicEmail: z.string().email().max(254).optional().nullable(),
};

/**
 * Draft save: allows partial updates (no submission side-effects).
 */
export const DoctorVerificationApplicationDraftSchema = z.object({
  fullName: baseFields.fullName.optional(),
  country: baseFields.country.optional(),
  specialty: baseFields.specialty.optional(),
  verificationMethod: baseFields.verificationMethod.optional(),
  applicantStatementAccepted: baseFields.applicantStatementAccepted.optional(),
  licenseNumber: baseFields.licenseNumber.optional(),
  clinicEmail: baseFields.clinicEmail.optional(),
});

export type DoctorVerificationApplicationDraftInput = z.infer<
  typeof DoctorVerificationApplicationDraftSchema
>;

/**
 * Submit: required fields + conditional requirements by verification method.
 * Document upload file requirement is enforced server-side by checking DB.
 */
export const DoctorVerificationApplicationSubmitSchema = z
  .object({
    ...baseFields,
    reapply: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.applicantStatementAccepted !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applicantStatementAccepted'],
        message: 'You must accept the statement to submit.',
      });
    }

    if (data.verificationMethod === 'license_number') {
      if (!data.licenseNumber || data.licenseNumber.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['licenseNumber'],
          message: 'License number is required for this verification method.',
        });
      }
    }

    if (data.verificationMethod === 'clinic_email') {
      if (!data.clinicEmail || data.clinicEmail.trim().length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clinicEmail'],
          message: 'Clinic email is required for this verification method.',
        });
      }
    }
  });

export type DoctorVerificationApplicationSubmitInput = z.infer<
  typeof DoctorVerificationApplicationSubmitSchema
>;

export type DoctorVerificationFileDto = {
  id: string;
  applicationId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type DoctorVerificationApplicationDto = {
  id: string;
  userId: string;
  status: DoctorVerificationApplicationStatus;
  fullName: string;
  country: string;
  specialty: DoctorVerificationSpecialty;
  verificationMethod: DoctorVerificationMethod;
  licenseNumber: string | null;
  clinicEmail: string | null;
  applicantStatementAccepted: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByAdminId: string | null;
  adminNotes: string | null;
  userFacingNote: string | null;
  createdAt: string;
  updatedAt: string;
  file: DoctorVerificationFileDto | null;
};
