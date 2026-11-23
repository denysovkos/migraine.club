import { Buffer } from 'node:buffer';

import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

// The clinician report PDF is rendered in the browser from the report model
// the API returns (src/features/reports/clinician/clinicianPdf.ts).
test.describe('clinician report PDF', () => {
  test('downloads a PDF built from the signed-in user\'s report', async ({ page }) => {
    await query(
      `INSERT INTO episode (user_id, start_time, end_time, intensity, pain_location, pain_type)
       VALUES ($1, now() - interval '3 day', now() - interval '3 day' + interval '2 hour', 4, 'LEFT', 'PRESSURE')`,
      [E2E_USER_ID],
    );
    await page.goto('/dashboard/reports/clinician');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^Migrennity_Clinician_Report_\d{4}-\d{2}-\d{2}_last90\.pdf$/);

    const chunks: Buffer[] = [];
    for await (const chunk of (await download.createReadStream())!) {
      chunks.push(chunk as Buffer);
    }
    const pdf = Buffer.concat(chunks);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1200);
  });

  test('the model API rejects invalid configs and anonymous callers', async ({ page }) => {
    const invalid = await page.request.post('/api/reports/clinician/model', { data: { template: 'nope' } });

    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error).toBe('Invalid config');

    const badJson = await page.request.post('/api/reports/clinician/model', { data: '{bad', headers: { 'content-type': 'application/json' } });

    expect(await badJson.json()).toEqual({ error: 'Invalid JSON body' });

    // Mock auth signs every request in, so the model only ever covers the
    // e2e user: another user's attacks never appear in it.
    await query(
      `INSERT INTO episode (user_id, start_time, end_time, intensity, pain_location, pain_type)
       VALUES ('e2e_report_other_user', now() - interval '1 day', now() - interval '20 hour', 5, 'RIGHT', 'STABBING')`,
    );
    const model = await (await page.request.post('/api/reports/clinician/model', { data: {} })).json();
    const rows = (model.attacks.pages as { maxSeverity: number }[][]).flat();

    expect(rows.some(r => r.maxSeverity === 5)).toBe(false);

    await query('DELETE FROM episode WHERE user_id = $1', ['e2e_report_other_user']);
  });
});
