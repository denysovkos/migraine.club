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
- Unhandled throws in a Node route (no try/catch) answered 500 with an empty
  body: use `httpx.Unhandled`. `error?.message` 500s use the Go error text.
- Parity steps can mark clock-derived keys as `volatile`; serial ids and
  UUIDs are normalised automatically.
- Parity runs: `/tmp/claude-0/servers.sh` (Next on :3001, Go on :3000), then
  `node --import tsx tests/parity/run.mts <filter>`.
- E2E through Go: `npx playwright test -c playwright.local.config.ts`.

## Fidelity helpers

- `internal/luxon`: `DateTime.fromISO(s, { zone })` incl. validation and DST
  resolution, checked against Luxon goldens (`scripts/luxon-golden.mts`).
- `httpx.JSONSyntaxMessage`: V8's `JSON.parse` SyntaxError text; `ReadJSON`
  errors carry it (`scripts/json-syntax-golden.mts`).
- `db.Drizzle(err, sql, params...)`: DrizzleQueryError's `Failed query: ...`
  text for routes that answered `error.message`.
- `localdate.JSDateFromYMD`: `ymdToDbDate` with V8 day rollover
  (2024-02-30 is 2024-03-01) and "Invalid time value".
- `jsx.Log` / `jsx.Exp`: fdlibm ports, bit-exact with V8's Math.log/exp
  (Go's math.Log/Exp differ in the last bit). Beware Go constant folding:
  `const z = 1.96; z*z` is exact, JS rounds; use variables in float formulas.
- `tests/parity/scenarios/insights.mts` needs `ENABLE_F39_INSIGHTS=true` on
  both servers to reach the engine (export it before `servers.sh`).
- TS goldens run with `npx tsx --tsconfig scripts/golden.tsconfig.json ...`
  (stubs the Logger, whose top-level await tsx cannot load).
- `jsx.Restringify` / `ParseJSON` / `Stringify`: `JSON.stringify(JSON.parse(x),
  null, indent)` as V8 prints it (array-index keys first, JS number format,
  raw U+2028/U+2029, lowercase `\u00xx`), golden in
  `scripts/json-stringify-golden.mts`. `httpx.Marshal` runs every response
  through it, so jsonb passed through as raw JSON prints like Node did.
- `q.Tables` (generated with the JSON key order): Drizzle keys, column names
  and a `SELECT *` scanner per table, used by the data export.
- Parity harness: serial sequences are reset before each run so both sides
  hand out the same ids; `exact: 'text'` compares bodies byte for byte,
  `exact: 'zip'` compares archive members and header fields; `masks` hide
  clock-dependent text such as the report's "Generated on" minute.
- The CSV export's ZIP members are deflated by Go's compress/flate: the
  compressed bytes differ from node:zlib's, the inflated contents, CRCs and
  every other header field are identical.
- `jsx.Round` is Math.round exactly (golden in jsformat-golden.mts):
  `floor(x + 0.5)` was wrong for 0.49999999999999994, odd integers above
  2^52 and the sign of -0.
- `jsx.OwnKeys` / `jsx.ToPropertyKey`: V8 property enumeration order and
  String(key) for tallies kept in plain JS objects (share summary).
- The share summary and new links' expiry use the server's local time zone
  (`time.Local`), as the Node Date methods did.
- `jsx.SortJS`: V8's TimSort, so NaN-returning or inconsistent comparators
  order like Node (golden `scripts/js-sort-golden.mts`). `jsx.Tally`: counts
  kept in a plain object, where `__proto__` is dropped and Object.prototype
  names (`constructor`, `toString`, ...) become strings; used for user tags.
- `jsx.SliceUTF16` + `jsx.JSString`: `str.slice()` in UTF-16 units; a cut
  surrogate pair is written as `\udXXX` like JSON.stringify does.
- zod: Zod 4.6's capSize, an array over `.max()` fails before its elements
  are parsed and the issue aborts (golden `array_cap`).
- Community stats read posts without ORDER BY; its parity scenario runs
  `VACUUM FULL` so both servers see the same heap order.
- `jsx.ParseIntNumber` is Number.parseInt as a JS number (digit runs past
  int64 stay large numbers, not NaN). Episode paging computes LIMIT/OFFSET in
  float64 like JS and sends them as bigint, so page 10000000000 is an empty
  page instead of an int32 overflow (fidelity.mts probes these).
- `httpx.ReadFormData` is `request.formData()` from Node 26's bundled undici
  (MIME parsing, multipart quirks, filename*, File type lowercasing);
  `jsx.UTF8Decode` / `jsx.DecodeURIComponent` follow WHATWG/ECMAScript
  (golden `scripts/text-decode-golden.mts`).
- zod: refinements run after continuing issues (failed checks) and add
  their issues, as Zod 4's runChecks does (golden `refine_after_soft`).
- Downloads with a filename above U+00FF were a 500 in Next (Headers take a
  ByteString); other names go out as UTF-8 bytes. E2E sets
  FILES_STORAGE_PATH for both servers (playwright.config.ts).
- Push: web-push always opened TLS (https.request) whatever the endpoint
  scheme, and the Go sender does the same. Error texts for transport
  failures (no status code) come from Go, not Node. The push parity
  scenario needs VAPID keys on both servers (Next rebuilt with them, since
  NEXT_PUBLIC_* is inlined), the HTTPS fake push service on :3099, and
  NODE_EXTRA_CA_CERTS / SSL_CERT_FILE trusting its certificate.
- `src/locales` has an embed.go so the Go translator (`internal/i18n`)
  reads the same messages.
- Cron: `internal/api/cron` is createCronRoute (secret, lease in
  cron_run_lock, deadline, health check); jobs live in `internal/service/jobs`.
  The cron parity scenario needs CRON_SECRET, ENABLE_STALE_EPISODE_REMINDER
  and ENABLE_F39_INSIGHTS on both servers plus the push setup above; it picks
  a timezone where it is 10:00–18:59 so the delivery windows are open.
  Luxon's `MMM` follows the server locale; Go prints English month names
  (en-US, what the Node server used).
- Mock auth ignores a client-sent `x-e2e-mock-user` header, as the Next
  proxy did by overwriting it.
- Sweep done: `tests/parity/scenarios/fidelity.mts` probes edge inputs on
  the routes ported before these helpers; add steps there for new edges.

## Upstream bugs fixed on this branch (in Node and Go together)

- `POST /api/intake/complete` with custom triggers was always a 500: the
  factor insert used `ON CONFLICT (user_id, key)`, which Postgres cannot match
  to the partial index `factor_user_key_uidx ... WHERE key IS NOT NULL`.
  The conflict target now repeats the predicate (e2e: onboarding.e2e.ts).
- Program recommendations counted factor-log events instead of days and
  gave today's logs `daysAgo = -1`, so the sleep program could say "Logged
  sleep_issue 15 of last 14 days". Logs now count once per local calendar
  day inside the window (collectSignals / recommendationEngine tests).
- `npm run e2e:reset` skipped the community tables (owned by `author_id` /
  `reporter_id`, not `user_id`) and missed weather_pain_index_snapshot,
  preventive_reminder_log, program_notification_log and mcp_tool_call_audit,
  so rows leaked between e2e tests. The list now lives in
  `scripts/e2eResetTables.ts`, checked against the schema and EXPORT_TABLES
  by `src/models/e2eResetTables.test.ts`.

- `POST /api/push/unsubscribe` deleted the endpoint's subscription even
  when it belonged to another user (it only left it out of the count). It
  now deletes only the caller's row (push.service.test.ts,
  PushSubscriptions.e2e.ts).

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
- [x] `/api/acute-doses` POST
- [x] `/api/acute-meds-report` GET
- [x] `/api/admin/doctor-verification/applications` GET
- [x] `/api/admin/doctor-verification/applications/[id]` GET
- [x] `/api/admin/doctor-verification/applications/[id]/approve` POST
- [x] `/api/admin/doctor-verification/applications/[id]/reject` POST
- [x] `/api/admin/doctor-verification/files/[fileId]` GET
- [x] `/api/admin/feature-requests` GET PATCH
- [x] `/api/appointment-preps` GET POST
- [x] `/api/appointment-preps/[id]` DELETE GET PATCH
- [x] `/api/community/comments` POST
- [x] `/api/community/posts` GET POST
- [x] `/api/community/posts/[id]` GET
- [x] `/api/community/posts/[id]/vote` POST
- [x] `/api/community/report` POST
- [x] `/api/community/stats` GET
- [x] `/api/cron/daily-risk` GET POST
- [x] `/api/cron/insights` GET POST
- [x] `/api/cron/medication-reminders` GET POST
- [x] `/api/cron/programs-reminders` GET POST
- [x] `/api/cron/solar-activity` GET POST
- [x] `/api/cron/stale-episode-reminder` GET POST
- [x] `/api/cycle/bleeding` DELETE PATCH POST PUT
- [x] `/api/cycle/calendar` GET
- [x] `/api/cycle/context` GET
- [x] `/api/cycle/data` DELETE
- [x] `/api/cycle/insights` GET
- [x] `/api/cycle/settings` GET PUT
- [x] `/api/diary/day` GET
- [x] `/api/diary/entry` PUT
- [x] `/api/diary/overlap` GET
- [x] `/api/diary/range` GET
- [x] `/api/diary/today` GET
- [x] `/api/doctor-verification/application` GET POST PUT
- [x] `/api/doctor-verification/files/[fileId]` GET
- [x] `/api/doctor-verification/upload` POST
- [x] `/api/dose-outcomes` POST
- [x] `/api/episodes` GET POST
- [x] `/api/episodes/[id]` DELETE GET PATCH
- [x] `/api/episodes/[id]/pain-readings` GET POST
- [x] `/api/episodes/[id]/pain-readings/[readingId]` DELETE
- [x] `/api/episodes/recent` GET
- [x] `/api/factors/log` POST
- [x] `/api/factors/options` GET
- [x] `/api/feature-requests` GET POST
- [x] `/api/insights` GET
- [x] `/api/insights/recompute` POST
- [x] `/api/insights/test-plans` GET POST
- [x] `/api/insights/test-plans/[id]` PATCH
- [x] `/api/intake` GET PATCH
- [x] `/api/intake/complete` POST
- [x] `/api/intake/skip` POST
- [ ] `/api/mcp` GET POST
- [x] `/api/medications/search` GET
- [x] `/api/moderation/reports` GET POST
- [x] `/api/moderation/role` GET
- [x] `/api/moderation/users` GET POST
- [x] `/api/moderation/visibility` GET POST
- [x] `/api/moh-status` GET
- [x] `/api/outcomes` GET
- [x] `/api/outcomes/monthly` GET
- [x] `/api/outcomes/settings` GET PUT
- [x] `/api/preventives` GET POST
- [x] `/api/preventives/[id]` DELETE GET PATCH
- [x] `/api/preventives/[id]/pause` POST
- [x] `/api/preventives/[id]/resume` POST
- [x] `/api/preventives/[id]/stop` POST
- [x] `/api/preventives/[id]/summary` GET
- [x] `/api/preventives/[id]/weekly-checkin` POST
- [x] `/api/preventives/due` GET
- [x] `/api/preventives/intake` POST
- [x] `/api/programs` GET
- [x] `/api/programs/[programId]` GET
- [x] `/api/programs/[programId]/end` POST
- [x] `/api/programs/[programId]/enroll` POST
- [x] `/api/programs/[programId]/pause` POST
- [x] `/api/programs/[programId]/progress` GET
- [x] `/api/programs/[programId]/resume` POST
- [x] `/api/programs/acute-med-timing/attack/[id]` GET
- [x] `/api/programs/enrollments` GET
- [x] `/api/programs/recommendations` GET
- [x] `/api/programs/recommendations/[programId]/dismiss` POST
- [x] `/api/programs/settings` GET PATCH
- [x] `/api/programs/sleep-regularity/log` POST
- [x] `/api/programs/sleep-regularity/today-status` GET
- [x] `/api/push/subscribe` POST
- [x] `/api/push/test` POST
- [x] `/api/push/unsubscribe` POST
- [x] `/api/questionnaires` GET POST
- [x] `/api/quick-add/episode` POST
- [x] `/api/quick-add/medication-intake` POST
- [x] `/api/quick-add/medication-intake/[id]` DELETE PATCH
- [x] `/api/quick-add/suggestions` GET
- [x] `/api/relief-sessions` GET POST
- [ ] `/api/reports/clinician/pdf` POST (moves to the SPA: the browser renders the same @react-pdf document from the report model; proxied to Next until then)
- [x] `/api/reports/clinician/preview` GET
- [x] `/api/share` DELETE GET POST
- [x] `/api/share/[token]` GET
- [x] `/api/space-weather/kp` GET
- [x] `/api/user-medications` GET POST
- [x] `/api/user-medications/[id]` PATCH
- [x] `/api/user/alerts` GET PUT
- [x] `/api/user/consent` DELETE GET POST
- [x] `/api/user/delete-account` DELETE
- [x] `/api/user/export` GET
- [x] `/api/user/pressure-alert` GET PUT
- [x] `/api/user/profile` GET PUT
- [x] `/api/user/weather-settings` GET PUT
- [x] `/api/weather-pain-index/current` GET
- [x] `/api/weather-pain-index/forecast` GET
- [x] `/api/weather-pain-index/history` GET
- [x] `/api/weather/pressure-outlook` GET
