import { expect, test } from './_fixtures';

/**
 * The server answers 429 once a client spends its budget for a kind of
 * request, and the other kinds keep working.
 */
test.describe('rate limits', () => {
  test('a client that floods an endpoint is told to slow down', async ({ page, request }) => {
    const report = { 'csp-report': { 'violated-directive': 'img-src', 'blocked-uri': 'https://e2e.example/x.png' } };

    // CSP reports have the smallest budget: 20 at once, 30 a minute, times
    // RATE_LIMIT_FACTOR (20) in this run, so 400 at once. Send them in
    // batches until one is refused.
    let refused: Awaited<ReturnType<typeof request.post>> | undefined;
    for (let sent = 0; sent < 800 && !refused; sent += 50) {
      const batch = await Promise.all(Array.from({ length: 50 }, () =>
        request.post('/api/csp-report', { data: report, headers: { 'Content-Type': 'application/csp-report' } })));
      for (const r of batch) {
        expect([204, 429]).toContain(r.status());
      }
      refused = batch.find(r => r.status() === 429);
    }

    expect(refused, 'no request was refused').toBeDefined();
    expect(Number(refused!.headers()['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(await refused!.json()).toEqual({ error: 'Too many requests' });

    // The budget refills within a second (here 10 a second), which also
    // leaves it usable for the specs that run after this one.
    await expect.poll(async () => (await request.post('/api/csp-report', {
      data: report,
      headers: { 'Content-Type': 'application/csp-report' },
    })).status()).toBe(204);

    // Reads, writes and pages have budgets of their own.
    const profile = await request.get('/api/user/profile');

    expect(profile.status()).toBe(200);

    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: /Hi,\s*E2E\./i })).toBeVisible();
  });
});
