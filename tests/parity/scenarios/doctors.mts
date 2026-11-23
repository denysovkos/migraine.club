import type { Scenario, Step } from '../run.mts';

const U = `'e2e_user_test_001'`;
const OTHER = 'parity_doc_applicant';
const APP = 'dddddddd-0000-4000-8000-0000000000d1';
const B = 'parityboundary0123456789abcdefXYZ';
const PDF = '%PDF-1.4 tiny';

const part = (headers: string[], body: string) => `--${B}\r\n${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
const multipart = (...parts: string[]) => `${parts.join('')}--${B}--\r\n`;
const mp = { 'content-type': `multipart/form-data; boundary=${B}` };
const upload = (name: string, rawBody: string, headers: Record<string, string> = mp): Step =>
  ({ name, method: 'POST', path: '/api/doctor-verification/upload', rawBody, headers });
const file = (step: string): Step => ({
  name: `download-${step}`,
  path: `/api/doctor-verification/files/{{${step}.body.file.id}}`,
  text: true,
  compareHeaders: ['content-disposition', 'x-content-type-options'],
});

const reset = [
  `DELETE FROM doctor_verification_file WHERE application_id IN (SELECT id FROM doctor_verification_application WHERE user_id IN (${U}, '${OTHER}'))`,
  `DELETE FROM doctor_verification_application WHERE user_id IN (${U}, '${OTHER}')`,
  `DELETE FROM feature_request WHERE user_id IN (${U}, '${OTHER}')`,
  `DELETE FROM "user" WHERE id = '${OTHER}'`,
];

const scenarios: Scenario[] = [
  {
    name: 'doctor verification as an applicant',
    sql: reset,
    steps: [
      { name: 'get-none', path: '/api/doctor-verification/application' },
      upload('upload-no-app', multipart(part(['Content-Disposition: form-data; name="file"; filename="a.pdf"', 'Content-Type: application/pdf'], PDF))),
      { name: 'draft-invalid', method: 'PUT', path: '/api/doctor-verification/application', body: { fullName: 'x', specialty: 'surgeon', clinicEmail: 'nope', licenseNumber: null } },
      { name: 'draft-bad-json', method: 'PUT', path: '/api/doctor-verification/application', rawBody: '{' },
      { name: 'draft', method: 'PUT', path: '/api/doctor-verification/application', body: { fullName: 'Dr Parity', verificationMethod: 'license_number' } },
      { name: 'draft-update', method: 'PUT', path: '/api/doctor-verification/application', body: { country: 'DE', licenseNumber: null, applicantStatementAccepted: true } },
      upload('upload-wrong-method', multipart(part(['Content-Disposition: form-data; name="file"; filename="a.pdf"', 'Content-Type: application/pdf'], PDF))),
      { name: 'draft-doc', method: 'PUT', path: '/api/doctor-verification/application', body: { verificationMethod: 'document_upload' } },
      upload('upload-not-multipart', '{}', { 'content-type': 'application/json' }),
      upload('upload-urlencoded', 'file=abc', { 'content-type': 'application/x-www-form-urlencoded' }),
      upload('upload-no-boundary', multipart(), { 'content-type': 'multipart/form-data' }),
      upload('upload-broken', `--${B}\r\nContent-Disposition: form-data; name="file"\r\n\r\nno end`),
      upload('upload-string-field', multipart(part(['Content-Disposition: form-data; name="file"'], 'just text'))),
      upload('upload-missing', multipart(part(['Content-Disposition: form-data; name="other"; filename="a.pdf"'], PDF))),
      upload('upload-type', multipart(part(['Content-Disposition: form-data; name="file"; filename="a.gif"', 'Content-Type: image/gif'], 'GIF89a'))),
      upload('upload-default-type', multipart(part(['Content-Disposition: form-data; name="file"; filename="a.txt"'], 'plain'))),
      upload('upload-big', multipart(part(['Content-Disposition: form-data; name="file"; filename="big.pdf"', 'Content-Type: application/pdf'], 'x'.repeat(1024 * 1024 + 1)))),
      upload('upload-bad-ext', multipart(part([`Content-Disposition: form-data; name="file"; filename*=latin1''a.pdf`, 'Content-Type: application/pdf'], PDF))),
      upload('upload-bad-uri', multipart(part([`Content-Disposition: form-data; name="file"; filename*=UTF-8''%E2%82`, 'Content-Type: application/pdf'], PDF))),
      upload('upload', multipart(part(['Content-Disposition: form-data; name="file"; filename="dir/sub\\\\lic\u0007ense %22v1%22.pdf"', 'Content-Type: Application/PDF'], PDF))),
      file('upload'),
      upload('upload-latin1', multipart(part([`Content-Disposition: form-data; name="file"; filename="x.pdf"; filename*=utf-8''caf%C3%A9.pdf`, 'Content-Type: application/pdf'], PDF))),
      file('upload-latin1'),
      upload('upload-unicode', multipart(part([`Content-Disposition: form-data; name="file"; filename*=UTF-8''%D0%BB%D0%B8%D1%86%D0%B5%D0%BD%D0%B7%D0%B8%D1%8F.png`, 'Content-Type: image/png'], 'PNG'))),
      file('upload-unicode'),
      upload('upload-base64', multipart(part(['Content-Disposition: form-data; name="file"; filename="b.pdf"', 'Content-Type: application/pdf', 'Content-Transfer-Encoding: base64'], 'JVBERi0x\r\nLjQ='))),
      file('upload-base64'),
      { name: 'get-with-file', path: '/api/doctor-verification/application', volatile: ['updatedAt'] },
      { name: 'submit-invalid', method: 'POST', path: '/api/doctor-verification/application', body: { fullName: 'Dr Parity', country: 'DE', specialty: 'gp', verificationMethod: 'clinic_email', applicantStatementAccepted: false, clinicEmail: '  ' } },
      { name: 'submit-no-license', method: 'POST', path: '/api/doctor-verification/application', body: { fullName: 'Dr Parity', country: 'DE', specialty: 'gp', verificationMethod: 'license_number', applicantStatementAccepted: true, licenseNumber: ' x ' } },
      { name: 'submit', method: 'POST', path: '/api/doctor-verification/application', body: { fullName: 'Dr Parity', country: 'DE', specialty: 'neurologist', verificationMethod: 'document_upload', applicantStatementAccepted: true } },
      { name: 'role-after', path: '/api/moderation/role' },
      { name: 'file-missing', path: '/api/doctor-verification/files/dddddddd-0000-4000-8000-0000000000ff' },
      { name: 'file-bad-id', path: '/api/doctor-verification/files/abc' },
      { name: 'admin-forbidden', path: '/api/admin/doctor-verification/applications' },
    ],
  },
  {
    name: 'doctor verification locks and re-apply',
    sql: [
      ...reset,
      `INSERT INTO doctor_verification_application (id, user_id, status, full_name, country, specialty, verification_method, submitted_at)
        VALUES ('${APP}', ${U}, 'rejected', 'Dr Old', 'DE', 'gp', 'license_number', now() - interval '2 day')`,
    ],
    steps: [
      { name: 'draft-rejected', method: 'PUT', path: '/api/doctor-verification/application', body: { fullName: 'Dr New' } },
      { name: 'submit-rejected', method: 'POST', path: '/api/doctor-verification/application', body: { fullName: 'Dr New', country: 'DE', specialty: 'gp', verificationMethod: 'license_number', applicantStatementAccepted: true, licenseNumber: 'LIC-1' } },
      { name: 'reapply-draft', method: 'PUT', path: '/api/doctor-verification/application?reapply=true', body: { fullName: 'Dr New' } },
      { name: 'reapply-submit', method: 'POST', path: '/api/doctor-verification/application', body: { fullName: 'Dr New', country: 'DE', specialty: 'gp', verificationMethod: 'license_number', applicantStatementAccepted: true, licenseNumber: 'LIC-1', reapply: true } },
      { name: 'get', path: '/api/doctor-verification/application' },
    ],
  },
  {
    name: 'doctor verification admin review',
    sql: [
      ...reset,
      `UPDATE "user" SET role = 'admin' WHERE id = ${U}`,
      `INSERT INTO "user" (id, display_name) VALUES ('${OTHER}', 'Applicant')`,
      `INSERT INTO doctor_verification_application (id, user_id, status, full_name, country, specialty, verification_method, admin_notes, submitted_at)
        VALUES ('${APP}', '${OTHER}', 'pending', 'Dr Other', 'FR', 'pain_specialist', 'document_upload', 'note', now() - interval '1 day')`,
      `INSERT INTO doctor_verification_application (user_id, status, full_name, country, specialty, verification_method)
        VALUES ('${OTHER}', 'pending', 'Draft only', 'FR', 'gp', 'license_number')`,
      `INSERT INTO doctor_verification_file (application_id, original_name, stored_name, relative_path, mime_type, size_bytes)
        VALUES ('${APP}', 'gone.pdf', 'x.pdf', 'doctor-verification/${APP}/x.pdf', 'application/pdf', 3)`,
    ],
    steps: [
      { name: 'list', path: '/api/admin/doctor-verification/applications' },
      { name: 'list-approved', path: '/api/admin/doctor-verification/applications?status=approved' },
      { name: 'list-odd', path: '/api/admin/doctor-verification/applications?status=nope' },
      { name: 'detail', path: `/api/admin/doctor-verification/applications/${APP}` },
      { name: 'detail-missing', path: '/api/admin/doctor-verification/applications/dddddddd-0000-4000-8000-0000000000ff' },
      { name: 'detail-bad-id', path: '/api/admin/doctor-verification/applications/abc' },
      { name: 'file-gone', path: '/api/admin/doctor-verification/files/{{detail.body.application.file.id}}' },
      { name: 'reject-invalid', method: 'POST', path: `/api/admin/doctor-verification/applications/${APP}/reject`, body: { reason: 'x', adminNotes: 5 } },
      { name: 'reject-bad-json', method: 'POST', path: `/api/admin/doctor-verification/applications/${APP}/reject`, rawBody: '{' },
      { name: 'reject', method: 'POST', path: `/api/admin/doctor-verification/applications/${APP}/reject`, body: { reason: 'Unreadable scan', userFacingNote: 'Please re-upload' } },
      { name: 'detail-rejected', path: `/api/admin/doctor-verification/applications/${APP}`, volatile: ['reviewedAt', 'updatedAt'] },
      { name: 'approve-missing', method: 'POST', path: '/api/admin/doctor-verification/applications/dddddddd-0000-4000-8000-0000000000ff/approve', body: {} },
      { name: 'approve-bad-id', method: 'POST', path: '/api/admin/doctor-verification/applications/abc/approve', body: {} },
      { name: 'approve', method: 'POST', path: `/api/admin/doctor-verification/applications/${APP}/approve`, rawBody: 'not json' },
      { name: 'detail-approved', path: `/api/admin/doctor-verification/applications/${APP}`, volatile: ['reviewedAt', 'updatedAt'] },
      { name: 'list-after', path: '/api/admin/doctor-verification/applications?status=approved' },
    ],
  },
  {
    name: 'feature requests',
    sql: [...reset, `INSERT INTO "user" (id, display_name) VALUES ('${OTHER}', 'Other')`, `INSERT INTO feature_request (user_id, title, description, resolution) VALUES ('${OTHER}', 'Other idea', 'Other description', 'SENT')`],
    steps: [
      { name: 'list-empty', path: '/api/feature-requests' },
      { name: 'create-invalid', method: 'POST', path: '/api/feature-requests', body: { title: '  ab ', description: 'short' } },
      { name: 'create-bad-json', method: 'POST', path: '/api/feature-requests', rawBody: 'nope' },
      { name: 'create-1', method: 'POST', path: '/api/feature-requests', body: { title: '  Dark mode  ', description: '  Please add a dark mode  ' } },
      { name: 'create-2', method: 'POST', path: '/api/feature-requests', body: { title: 'Export', description: 'Export to CSV please' } },
      { name: 'create-3', method: 'POST', path: '/api/feature-requests', body: { title: 'Widget', description: 'A home screen widget' } },
      { name: 'create-limit', method: 'POST', path: '/api/feature-requests', body: { title: 'Fourth', description: 'One more request' } },
      { name: 'list', path: '/api/feature-requests' },
      { name: 'admin-forbidden', path: '/api/admin/feature-requests' },
      { name: 'make-admin', method: 'POST', path: '/api/moderation/users', body: { userId: 'e2e_user_test_001', role: 'admin' } },
    ],
  },
  {
    name: 'feature requests as admin',
    sql: [...reset, `UPDATE "user" SET role = 'admin' WHERE id = ${U}`, `INSERT INTO "user" (id, display_name) VALUES ('${OTHER}', 'Other')`, `INSERT INTO feature_request (id, user_id, title, description, resolution) VALUES ('${APP}', '${OTHER}', 'Other idea', 'Other description', 'SENT')`],
    steps: [
      { name: 'admin-list', path: '/api/admin/feature-requests' },
      { name: 'patch-invalid', method: 'PATCH', path: '/api/admin/feature-requests', body: { requestId: 'x', resolution: 'DONE' } },
      { name: 'patch-missing', method: 'PATCH', path: '/api/admin/feature-requests', body: { requestId: 'dddddddd-0000-4000-8000-0000000000ff', resolution: 'ACCEPTED' } },
      { name: 'patch', method: 'PATCH', path: '/api/admin/feature-requests', body: { requestId: APP, resolution: 'IN REVIEW' } },
      { name: 'create-after-review', method: 'POST', path: '/api/feature-requests', body: { title: 'Mine', description: 'My own request' } },
      { name: 'admin-list-after', path: '/api/admin/feature-requests', volatile: ['updatedAt'] },
    ],
  },
];

export default scenarios;
