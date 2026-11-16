import { describe, expect, it } from 'vitest';

import { validateDoctorVerificationUpload } from './doctorVerificationUploadValidation';

describe('doctorVerificationUploadValidation', () => {
  it('rejects files larger than 1MB', () => {
    expect(() => validateDoctorVerificationUpload({ size: 1 * 1024 * 1024 + 1, type: 'application/pdf' }))
      .toThrowError('FILE_TOO_LARGE');
  });

  it('rejects unsupported mime types', () => {
    expect(() => validateDoctorVerificationUpload({ size: 10, type: 'application/zip' }))
      .toThrowError('INVALID_MIME_TYPE');
  });

  it('accepts allowed types', () => {
    expect(validateDoctorVerificationUpload({ size: 10, type: 'application/pdf' }).ext).toBe('pdf');
    expect(validateDoctorVerificationUpload({ size: 10, type: 'image/jpeg' }).ext).toBe('jpg');
    expect(validateDoctorVerificationUpload({ size: 10, type: 'image/png' }).ext).toBe('png');
  });
});
