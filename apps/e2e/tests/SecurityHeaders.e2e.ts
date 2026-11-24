import { expect, test } from './_fixtures';

/**
 * Browser protections on every response, and the endpoint that collects
 * reports for the report-only Content-Security-Policy.
 */
test.describe('security headers', () => {
  test('pages, API responses and files carry them', async ({ page, request }) => {
    const res = await page.goto('/dashboard');
    const headers = res!.headers();

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['content-security-policy-report-only']).toContain('report-uri /api/csp-report');
    expect(headers['content-security-policy']).toBeUndefined();

    await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

    for (const path of ['/api/user/profile', '/sw.js', '/robots.txt']) {
      const r = await request.get(path);

      expect(r.headers()['x-content-type-options'], path).toBe('nosniff');
      expect(r.headers()['x-frame-options'], path).toBe('DENY');
    }
  });

  test('CSP reports are accepted and validated', async ({ request }) => {
    const report = { 'csp-report': {
      'document-uri': 'http://localhost/dashboard',
      'violated-directive': 'script-src-elem',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://cdn.example/x.js',
    } };
    const ok = await request.post('/api/csp-report', { data: report, headers: { 'content-type': 'application/csp-report' } });

    expect(ok.status()).toBe(204);

    const bad = await request.post('/api/csp-report', { data: 'nope', headers: { 'content-type': 'application/csp-report' } });

    expect(bad.status()).toBe(400);

    const empty = await request.post('/api/csp-report', { data: { 'csp-report': {} } });

    expect(empty.status()).toBe(400);
  });
});
