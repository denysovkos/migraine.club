# Next.js → Go migration status

Working branch for the one-shot migration from Next.js to a single Go binary
(chi + pgx + sqlc) that serves the React SPA. Everything must stay functionally
and visually identical; the existing Playwright suite is the acceptance gate.

## Decisions

- Migrations stay in `migrations/` with drizzle's journal and bookkeeping table
  (`drizzle.__drizzle_migrations`). `internal/db.Migrate` reproduces drizzle's
  rule exactly, so production needs no conversion step.
- JSON fidelity: timestamps marshal like `Date.prototype.toISOString`
  (`internal/jsontime`), JSON keys are the camelCase column names Drizzle used.
- Cron endpoints keep the HTTP + `CRON_SECRET` contract and the
  `cron_run_lock` lease table.
- No OpenAPI codegen: handlers keep the exact hand-written JSON contracts the
  frontend already consumes; parity is proven by tests instead.

## Progress

- [x] Baseline: lint, types, 861 unit tests, 50 e2e (Chromium) green on main
- [x] MCP OAuth spike (JWT `at+jwt` via JWKS, opaque `oat_` via Backend API)
- [x] Drizzle-compatible migrator + test database helper
- [ ] Server skeleton, auth, mock auth
- [ ] API domains (see below)
- [ ] Crons, push, MCP
- [ ] Frontend on Vite
- [ ] Cutover, CI, docs
