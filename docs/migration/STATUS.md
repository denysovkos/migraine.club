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

## Conventions (read before porting a route)

- One package per API area under `internal/api/<area>`, shared logic under
  `internal/service/<name>`. Register routes in the area's `Mount`, and the
  area in `internal/server/routes.go`.
- SQL lives in `internal/db/queries/*.sql`; run `make gen` (needs
  `TEST_DATABASE_URL`) after changing queries or migrations. Every UPDATE on a
  table with `$onUpdate` in Schema.ts must set `updated_at = @now` itself.
- Responses: `httpx.JSON` / `httpx.O(...)` (ordered keys). Never `httpx.M` in
  responses. Full rows marshal in Drizzle key order automatically.
- Validation: port each Zod schema with `internal/zod`; error bodies must be
  byte-identical (`httpx.ValidationError`, `Flatten().FieldErrors`).
- JS semantics: `internal/jsx` (UTF-16 lengths, trim, ToInt32, Math.round),
  `internal/jsontime` (toISOString format, date/time columns).
- Every route gets: Go handler tests on a real database (`internal/apitest`)
  covering auth, validation, happy path and cross-user isolation; ported unit
  tests for its service; and a parity scenario in `tests/parity/scenarios`.
- Parity runs: `/tmp/claude-0/servers.sh` (Next on :3001, Go on :3000), then
  `node --import tsx tests/parity/run.mts <filter>`.
- E2E through Go: `npx playwright test -c playwright.local.config.ts`.

## Progress

- [x] Baseline: lint, types, 861 unit tests, 50 e2e (Chromium) green on main
- [x] MCP OAuth spike (JWT `at+jwt` via JWKS, opaque `oat_` via Backend API)
- [x] Drizzle-compatible migrator + test database helper
- [x] Server skeleton, auth, mock auth, forwarded headers, parity harness
- [ ] Crons, push, MCP
- [ ] Frontend on Vite
- [ ] Cutover, CI, docs

### Routes

- [ ] `/.well-known/oauth-authorization-server` GET
- [ ] `/.well-known/oauth-protected-resource/mcp` GET
- [ ] `/api/acute-doses` POST
- [ ] `/api/acute-meds-report` GET
- [ ] `/api/admin/doctor-verification/applications` GET
- [ ] `/api/admin/doctor-verification/applications/[id]` GET
- [ ] `/api/admin/doctor-verification/applications/[id]/approve` POST
- [ ] `/api/admin/doctor-verification/applications/[id]/reject` POST
- [ ] `/api/admin/doctor-verification/files/[fileId]` GET
- [ ] `/api/admin/feature-requests` GET PATCH
- [ ] `/api/appointment-preps` GET POST
- [ ] `/api/appointment-preps/[id]` DELETE GET PATCH
- [ ] `/api/community/comments` POST
- [ ] `/api/community/posts` GET POST
- [ ] `/api/community/posts/[id]` GET
- [ ] `/api/community/posts/[id]/vote` POST
- [ ] `/api/community/report` POST
- [ ] `/api/community/stats` GET
- [ ] `/api/cron/daily-risk` GET POST
- [ ] `/api/cron/insights` GET POST
- [ ] `/api/cron/medication-reminders` GET POST
- [ ] `/api/cron/programs-reminders` GET POST
- [ ] `/api/cron/solar-activity` GET POST
- [ ] `/api/cron/stale-episode-reminder` GET POST
- [ ] `/api/cycle/bleeding` DELETE PATCH POST PUT
- [ ] `/api/cycle/calendar` GET
- [ ] `/api/cycle/context` GET
- [ ] `/api/cycle/data` DELETE
- [ ] `/api/cycle/insights` GET
- [ ] `/api/cycle/settings` GET PUT
- [ ] `/api/diary/day` GET
- [ ] `/api/diary/entry` PUT
- [ ] `/api/diary/overlap` GET
- [ ] `/api/diary/range` GET
- [ ] `/api/diary/today` GET
- [ ] `/api/doctor-verification/application` GET POST PUT
- [ ] `/api/doctor-verification/files/[fileId]` GET
- [ ] `/api/doctor-verification/upload` POST
- [ ] `/api/dose-outcomes` POST
- [x] `/api/episodes` GET POST
- [x] `/api/episodes/[id]` DELETE GET PATCH
- [x] `/api/episodes/[id]/pain-readings` GET POST
- [x] `/api/episodes/[id]/pain-readings/[readingId]` DELETE
- [x] `/api/episodes/recent` GET
- [ ] `/api/factors/log` POST
- [ ] `/api/factors/options` GET
- [ ] `/api/feature-requests` GET POST
- [ ] `/api/insights` GET
- [ ] `/api/insights/recompute` POST
- [ ] `/api/insights/test-plans` GET POST
- [ ] `/api/insights/test-plans/[id]` PATCH
- [ ] `/api/intake` GET PATCH
- [ ] `/api/intake/complete` POST
- [ ] `/api/intake/skip` POST
- [ ] `/api/mcp` GET POST
- [ ] `/api/medications/search` GET
- [ ] `/api/moderation/reports` GET POST
- [ ] `/api/moderation/role` GET
- [ ] `/api/moderation/users` GET POST
- [ ] `/api/moderation/visibility` GET POST
- [ ] `/api/moh-status` GET
- [ ] `/api/outcomes` GET
- [ ] `/api/outcomes/monthly` GET
- [ ] `/api/outcomes/settings` GET PUT
- [ ] `/api/preventives` GET POST
- [ ] `/api/preventives/[id]` DELETE GET PATCH
- [ ] `/api/preventives/[id]/pause` POST
- [ ] `/api/preventives/[id]/resume` POST
- [ ] `/api/preventives/[id]/stop` POST
- [ ] `/api/preventives/[id]/summary` GET
- [ ] `/api/preventives/[id]/weekly-checkin` POST
- [ ] `/api/preventives/due` GET
- [ ] `/api/preventives/intake` POST
- [ ] `/api/programs` GET
- [ ] `/api/programs/[programId]` GET
- [ ] `/api/programs/[programId]/end` POST
- [ ] `/api/programs/[programId]/enroll` POST
- [ ] `/api/programs/[programId]/pause` POST
- [ ] `/api/programs/[programId]/progress` GET
- [ ] `/api/programs/[programId]/resume` POST
- [ ] `/api/programs/acute-med-timing/attack/[id]` GET
- [ ] `/api/programs/enrollments` GET
- [ ] `/api/programs/recommendations` GET
- [ ] `/api/programs/recommendations/[programId]/dismiss` POST
- [ ] `/api/programs/settings` GET PATCH
- [ ] `/api/programs/sleep-regularity/log` POST
- [ ] `/api/programs/sleep-regularity/today-status` GET
- [ ] `/api/push/subscribe` POST
- [ ] `/api/push/test` POST
- [ ] `/api/push/unsubscribe` POST
- [ ] `/api/questionnaires` GET POST
- [ ] `/api/quick-add/episode` POST
- [ ] `/api/quick-add/medication-intake` POST
- [ ] `/api/quick-add/medication-intake/[id]` DELETE PATCH
- [ ] `/api/quick-add/suggestions` GET
- [ ] `/api/relief-sessions` GET POST
- [ ] `/api/reports/clinician/pdf` POST
- [ ] `/api/reports/clinician/preview` GET
- [ ] `/api/share` DELETE GET POST
- [ ] `/api/share/[token]` GET
- [x] `/api/space-weather/kp` GET
- [ ] `/api/user-medications` GET POST
- [ ] `/api/user-medications/[id]` PATCH
- [ ] `/api/user/alerts` GET PUT
- [x] `/api/user/consent` DELETE GET POST
- [ ] `/api/user/delete-account` DELETE
- [ ] `/api/user/export` GET
- [ ] `/api/user/pressure-alert` GET PUT
- [x] `/api/user/profile` GET PUT
- [x] `/api/user/weather-settings` GET PUT
- [x] `/api/weather-pain-index/current` GET
- [x] `/api/weather-pain-index/forecast` GET
- [x] `/api/weather-pain-index/history` GET
- [ ] `/api/weather/pressure-outlook` GET
