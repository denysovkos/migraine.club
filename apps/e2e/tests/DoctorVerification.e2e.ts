import { Buffer } from 'node:buffer';
import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

const PATH = '/en/dashboard/settings/doctor-verification';
const OTHER_USER_ID = 'e2e_doctor_other_user';

test.describe('doctor verification', () => {
  test.afterEach(async () => {
    await query('DELETE FROM doctor_verification_file WHERE application_id IN (SELECT id FROM doctor_verification_application WHERE user_id = $1)', [OTHER_USER_ID]);
    await query('DELETE FROM doctor_verification_application WHERE user_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM "user" WHERE id = $1', [OTHER_USER_ID]);
  });

  test('doctor uploads a document, submits, and an admin approves', async ({ page }) => {
    await page.goto(PATH);
    await page.locator('#doctor-verification-full-name').fill('Dr E2E');
    await page.locator('#doctor-verification-country').fill('DE');
    await page.locator('#doctor-verification-specialty').selectOption('neurologist');
    await page.locator('#doctor-verification-method').selectOption('document_upload');
    await page.locator('input[type="file"]').setInputFiles({ name: 'license.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') });
    const uploaded = page.waitForResponse(r => r.url().endsWith('/api/doctor-verification/upload'));
    await page.getByRole('button', { name: 'Upload file' }).click();

    expect((await uploaded).status()).toBe(200);
    await expect(page.getByText('license.pdf')).toBeVisible();

    await page.getByText('I confirm I am a licensed healthcare professional').click();
    const submitted = page.waitForResponse(r => r.url().endsWith('/api/doctor-verification/application') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit for verification' }).click();

    expect((await submitted).status()).toBe(200);

    const [app] = await query<{ id: string; status: string; submitted_at: Date | null; role: string }>(
      `SELECT a.id, a.status, a.submitted_at, u.role FROM doctor_verification_application a JOIN "user" u ON u.id = a.user_id WHERE a.user_id = $1`,
      [E2E_USER_ID],
    );

    expect(app).toMatchObject({ status: 'pending', role: 'doctor_pending' });
    expect(app!.submitted_at).not.toBeNull();

    const file = await (await page.request.get('/api/doctor-verification/application')).json();
    const download = await page.request.get(`/api/doctor-verification/files/${file.application.file.id}`);

    expect(await download.text()).toBe('%PDF-1.4 e2e');
    expect(download.headers()['content-disposition']).toBe('attachment; filename="license.pdf"');

    expect((await page.request.get('/api/admin/doctor-verification/applications')).status()).toBe(403);

    await query('UPDATE "user" SET role = \'admin\' WHERE id = $1', [E2E_USER_ID]);
    const list = await (await page.request.get('/api/admin/doctor-verification/applications')).json();

    expect(list.applications.map((a: { id: string }) => a.id)).toContain(app!.id);

    const approved = await page.request.post(`/api/admin/doctor-verification/applications/${app!.id}/approve`, { data: { userFacingNote: 'Welcome' } });

    expect(await approved.json()).toEqual({ success: true });

    const [after] = await query<{ status: string; role: string }>(
      `SELECT a.status, u.role FROM doctor_verification_application a JOIN "user" u ON u.id = a.user_id WHERE a.id = $1`,
      [app!.id],
    );

    expect(after).toEqual({ status: 'approved', role: 'doctor_verified' });
  });

  test('API validates submissions and uploads', async ({ page }) => {
    const submit = await page.request.post('/api/doctor-verification/application', {
      data: { fullName: 'Dr X', country: 'DE', specialty: 'gp', verificationMethod: 'license_number', applicantStatementAccepted: false },
    });

    expect(submit.status()).toBe(400);
    expect(Object.keys((await submit.json()).details.fieldErrors)).toEqual(['applicantStatementAccepted', 'licenseNumber']);

    const noDraft = await page.request.post('/api/doctor-verification/upload', { multipart: { file: { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') } } });

    expect((await noDraft.json()).code).toBe('NO_APPLICATION');

    await page.request.put('/api/doctor-verification/application', { data: { verificationMethod: 'document_upload' } });
    const gif = await page.request.post('/api/doctor-verification/upload', { multipart: { file: { name: 'a.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF') } } });

    expect(gif.status()).toBe(415);
  });

  test('one user never downloads another user\'s document', async ({ page }) => {
    await query('INSERT INTO "user" (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [OTHER_USER_ID, 'Other']);
    const [file] = await query<{ id: string }>(
      `WITH a AS (INSERT INTO doctor_verification_application (user_id, full_name, country, specialty, verification_method)
         VALUES ($1, 'Other', 'DE', 'gp', 'document_upload') RETURNING id)
       INSERT INTO doctor_verification_file (application_id, original_name, stored_name, relative_path, mime_type, size_bytes)
       SELECT id, 'x.pdf', 'x.pdf', 'doctor-verification/x/x.pdf', 'application/pdf', 1 FROM a RETURNING id`,
      [OTHER_USER_ID],
    );

    expect((await page.request.get(`/api/doctor-verification/files/${file!.id}`)).status()).toBe(403);
    expect(await (await page.request.get('/api/doctor-verification/application')).json()).toEqual({ application: null });
  });
});
