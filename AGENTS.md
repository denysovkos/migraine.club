# AGENTS.md

## Scope
These instructions apply to the entire repository unless a deeper `AGENTS.md` overrides them.

## Project Summary
- Product: `migraine.club` / Migrennity, a migraine tracking application.
- Layout: an npm workspace driven by Turborepo. `apps/server` (Go), `apps/client` (React), `apps/e2e` (Playwright), `packages/db` (schema and seeds), `packages/locales` (UI messages).
- Server: Go (`apps/server`): REST API, MCP endpoint, scheduled jobs, push delivery, and serving the frontend.
- Frontend: React and TypeScript built with Vite (`apps/client`) into a single-page app; pages and layouts live in `apps/client/src/app`, written in App Router style.
- Styling: Tailwind CSS with shadcn/ui-style components.
- Auth: Clerk.
- Data: Postgres through sqlc (`apps/server/internal/db`); the schema is authored in `packages/db/src/schema.ts` and migrations generated with drizzle-kit into `apps/server/migrations`.
- i18n: `next-intl` in the browser, locale routing in the Go server (`apps/server/internal/spa`), routes under `apps/client/src/app/[locale]`; messages in `packages/locales`.

## Working Rules
- Preserve the existing architecture; prefer small, localized changes over broad refactors.
- Treat migraine episode and user health-related data as sensitive; do not introduce logging of personal or medical details.
- Keep UI copy translatable. Avoid hardcoded user-facing strings when editing localized surfaces.
- Match the existing TypeScript, React, and Tailwind patterns already used in nearby files.
- Do not change environment-variable names or auth/billing behavior unless the task explicitly requires it.

## Repository Map
- `apps/server`: the Go server (`cmd/server`; `internal/api` handlers, `internal/service` domain logic, `internal/db` queries, `internal/mcp`, `internal/spa`; `migrations`; `content/programs`).
- `apps/client/spa`: the SPA runtime: entry, router built from `src/app`, shims for the `next/*` modules the pages import.
- `apps/client/src/app`: pages and layouts; `[locale]` holds the localized UI routes.
- `apps/client/src/components`: shared UI building blocks.
- `apps/client/src/features`: feature-specific UI and logic.
- `apps/client/src/services`: API response types and client-side helpers; the server logic is in `apps/server/internal/service`.
- `apps/client/src/models`: client-side models (intake answers).
- `apps/e2e`: Playwright specs (`tests`) and the seeds they run (`seeds`).
- `packages/db`: drizzle schema, drizzle-kit config, medication catalog seed.
- `packages/locales`: `en.json`, `fr.json`, `uk.json`, also embedded in the server (a Go module of its own).

## Common Commands
Root scripts run through Turborepo across all packages; add `-- --filter=@migraine/<name>` to run one package.
- Install dependencies: `npm install`
- Start the server and the frontend with hot reload: `npm run dev`
- Build production app: `npm run build` (then `npm start`)
- Run lint (ESLint, and golangci-lint for the server): `npm run lint`
- Run type checks: `npm run check-types`
- Run unit tests (Vitest and Go): `npm test`
- Run e2e tests: `npm run test:e2e`
- Regenerate sqlc code and the schema snapshot: `npm run gen`

## Change Guidance
- Pages render in the browser; data comes from the Go API. Add server logic in `apps/server`, not in `apps/client`.
- For API changes, validate inputs at the boundary and keep auth requirements intact.
- For database changes, update `packages/db/src/schema.ts` first, generate the migration with `npm run db:generate`, then `npm run gen`.
- For settings, billing, and authentication flows, verify redirects and Clerk integration points carefully.
- For weather or analytics features, avoid changing derived calculations without understanding downstream dashboard usage.

## Validation
- Prefer targeted validation first: run the smallest relevant lint, type-check, or test command for the files changed.
- If you change UI behavior, add or update tests when there is an existing nearby pattern.
- Do not fix unrelated failing tests as part of a focused task.

## Environment Notes
- Node.js 26+ (see `.nvmrc`) and Go 1.27 (see `go.mod`) are required.
- Runtime configuration is validated in `apps/server/internal/config`; `NEXT_PUBLIC_*` values are inlined into the frontend at build time.
- Key integrations include Clerk, Stripe, OpenWeatherMap, and optional hosted Postgres.

## Avoid
- Do not commit build output, coverage artifacts, or dependency directories.
- Do not remove localization structure or flatten locale-aware routes.
- Do not add broad formatting-only churn unless the task explicitly asks for it.
