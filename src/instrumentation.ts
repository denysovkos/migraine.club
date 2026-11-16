/**
 * Next.js calls `register()` once per server process, before the server starts
 * handling requests, and skips it entirely during production builds. That makes
 * it the right place to apply migrations: the build no longer touches the
 * database, so build workers can never race each other applying the same
 * migration.
 */
export async function register(): Promise<void> {
  // The edge runtime has no pg driver; migrations only make sense on Node.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { runMigrations } = await import('./libs/DB');

  await runMigrations();
}
