## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)

## Tests are mandatory

No change is done until it is covered by tests and they pass. This applies to every feature, bug fix and refactor.

- Unit tests: every new or changed Go handler, service or helper gets a `*_test.go` next to it (`make test`; database-backed tests use `TEST_DATABASE_URL`), and every new or changed hook, helper or component in `src/` or `web/` gets a `*.test.ts(x)` next to it (Vitest). A bug fix starts with a test that fails without the fix.
- E2E tests: every user-facing flow or API endpoint a user can reach gets a Playwright spec in `tests/e2e/*.e2e.ts`, using the `test` from `tests/e2e/_fixtures.ts` (mock auth, per-test reset and seed). Use `tests/e2e/_db.ts` to arrange or assert rows directly. Cover the happy path, input validation, and that one user never sees another user's data.
- New seed data a spec needs goes into `scripts/e2e-seed*.ts`, never into the spec as a dependency on an external service. New user-scoped tables also go into `scripts/e2eResetTables.ts` and `Tables` in `internal/service/dataexport/dataexport.go` (`src/models/e2eResetTables.test.ts` checks both).
- Before reporting work as done, run and report the results of: `make lint`, `make test`, `npm run lint`, `npm run check-types`, `npm test`, and `npm run test:e2e` (needs `DATABASE_URL` pointing at a Postgres you can wipe, and a build made with `E2E_MOCK_AUTH=true npm run build`).
- CI (`.github/workflows/CI.yml`) runs all of these, including e2e on Chromium and Firefox against a production build (the Go server serving the frontend build) and a Docker image build. A red pipeline blocks merge.
- Never skip, disable, delete or loosen a test to get green. If a test is wrong, fix it and say why in the commit message.
