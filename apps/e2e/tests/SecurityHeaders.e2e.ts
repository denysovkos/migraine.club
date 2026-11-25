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

    // The e2e server enforces the policy (CSP_ENFORCE), as production should.
    const csp = headers['content-security-policy'];

    expect(csp).toMatch(/script-src 'nonce-[\w+/=]+' 'strict-dynamic'/);

    // Reports of blocked inline code carry its first characters.
    expect(csp).toContain('\'report-sample\'');
    expect(csp).toContain('report-uri /api/csp-report');

    // The page's own scripts carry the nonce the policy names.
    const nonce = /'nonce-([\w+/=]+)'/.exec(csp!)![1];
    const html = await res!.text();

    expect(html).toContain(`<script nonce="${nonce}" type="module"`);

    await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();

    for (const path of ['/api/user/profile', '/sw.js', '/robots.txt']) {
      const r = await request.get(path);

      expect(r.headers()['x-content-type-options'], path).toBe('nosniff');
      expect(r.headers()['x-frame-options'], path).toBe('DENY');
    }
  });

  test('the app runs under the enforced policy without violations', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as any).__cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`);
      });
    });

    for (const path of ['/', '/dashboard', '/dashboard/diary', '/dashboard/settings']) {
      await page.goto(path);

      // Rendered: the router has run and the page has filled its <main>.
      await expect(page.locator('main').first()).not.toBeEmpty();

      // Zod probes eval once to pick its fastest parser and falls back
      // quietly when the policy forbids it; nothing else may be blocked.
      const blocked = (await page.evaluate(() => (window as any).__cspViolations as string[]))
        .filter(v => v !== 'script-src eval');

      expect(blocked, path).toEqual([]);
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
