import { describe, expect, it } from 'vitest';

import { DoctorVerificationApplicationSubmitSchema } from './DoctorVerification';

describe('DoctorVerificationApplicationSubmitSchema', () => {
  it('requires applicantStatementAccepted', () => {
    const result = DoctorVerificationApplicationSubmitSchema.safeParse({
      fullName: 'Jane Doe',
      country: 'US',
      specialty: 'neurologist',
      verificationMethod: 'license_number',
      licenseNumber: 'ABC123',
      applicantStatementAccepted: false,
    });

    expect(result.success).toBe(false);
  });

  it('requires licenseNumber when verificationMethod=license_number', () => {
    const result = DoctorVerificationApplicationSubmitSchema.safeParse({
      fullName: 'Jane Doe',
      country: 'US',
      specialty: 'neurologist',
      verificationMethod: 'license_number',
      applicantStatementAccepted: true,
    });

    expect(result.success).toBe(false);
  });

  it('requires clinicEmail when verificationMethod=clinic_email', () => {
    const result = DoctorVerificationApplicationSubmitSchema.safeParse({
      fullName: 'Jane Doe',
      country: 'US',
      specialty: 'gp',
      verificationMethod: 'clinic_email',
      applicantStatementAccepted: true,
    });

    expect(result.success).toBe(false);
  });

  it('accepts document_upload method (file requirement enforced server-side)', () => {
    const result = DoctorVerificationApplicationSubmitSchema.safeParse({
      fullName: 'Jane Doe',
      country: 'US',
      specialty: 'pain_specialist',
      verificationMethod: 'document_upload',
      applicantStatementAccepted: true,
    });

    expect(result.success).toBe(true);
  });
});
