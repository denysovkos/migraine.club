# AGENTS.md

## Scope
These instructions apply to the entire repository unless a deeper `AGENTS.md` overrides them.

## Project Summary
- Product: `migraine.club` / Migrennity, a migraine tracking application.
- Server: Go (`cmd/server`, `internal/`): REST API, MCP endpoint, scheduled jobs, push delivery, and serving the frontend.
- Frontend: React and TypeScript built with Vite (`web/`) into a single-page app; pages and layouts live in `src/app`, written in App Router style.
- Styling: Tailwind CSS with shadcn/ui-style components.
- Auth: Clerk.
- Data: Postgres through sqlc (`internal/db`); the schema is authored in `src/models/Schema.ts` and migrations generated with drizzle-kit.
- i18n: `next-intl` in the browser, locale routing in the Go server (`internal/spa`), routes under `src/app/[locale]`.

## Working Rules
- Preserve the existing architecture; prefer small, localized changes over broad refactors.
- Treat migraine episode and user health-related data as sensitive; do not introduce logging of personal or medical details.
- Keep UI copy translatable. Avoid hardcoded user-facing strings when editing localized surfaces.
- Match the existing TypeScript, React, and Tailwind patterns already used in nearby files.
- Do not change environment-variable names or auth/billing behavior unless the task explicitly requires it.

## Repository Map
- `cmd/server`, `internal/`: the Go server (`internal/api` handlers, `internal/service` domain logic, `internal/db` queries, `internal/mcp`, `internal/spa`).
- `web/`: the Vite app: router built from `src/app`, shims for the `next/*` modules the pages import.
- `src/app`: pages and layouts.
- `src/app/[locale]`: localized UI routes.
- `src/components`: shared UI building blocks.
- `src/features`: feature-specific UI and logic.
- `src/services`, `src/repositories`: shared types and client-side helpers; the server logic is in `internal/service`.
- `src/models`: schema (drizzle-kit) and related types.
- `tests`: automated tests, including Playwright coverage.
- `scripts`: maintenance and utility scripts.

## Cursor Personas
The `.cursor` folder exists and currently contains these persona/rule files:

- `.cursor/backend-engineer.rule`: use for API design, services, repositories, database boundaries, privacy-aware backend logic, and observability decisions.
- `.cursor/frontend-engineer.rule`: use for React/Next.js UI work, component structure, state handling, responsiveness, and accessibility.
- `.cursor/design-ui-ux.rule`: use for visual design, layout, design tokens, component presentation, and migraine-friendly UX choices.
- `.cursor/product-manager.rule`: use for feature scoping, PRD-lite work, user stories, acceptance criteria, and product tradeoff framing.
- `.cursor/qa.rule`: use for test strategy, regression planning, risk-based coverage, and automation guidance.
- `.cursor/translations.rule`: use for any user-facing copy changes, translation-key additions, and i18n consistency checks.

## Persona Usage
- Pick the persona that matches the task before making substantial changes.
- Combine personas when needed:
  - frontend + design-ui-ux for UI implementation;
  - frontend + translations for visible copy changes;
  - backend + qa for endpoint and service changes;
  - product-manager before large feature scoping or ambiguous requests.
- Treat `translations.rule` as mandatory whenever a change adds or edits user-facing text.
- If a rule conflicts with the live repository setup, follow the repository implementation while preserving the rule's intent.
- When summarizing work, mention which persona guidance shaped the solution if it materially affected the approach.

## Common Commands
- Install dependencies: `npm install`
- Start the server: `npm run dev:server`; the frontend with hot reload: `npm run dev`
- Build production app: `npm run build` (then `npm start`)
- Go lint and tests: `make lint`, `make test`
- Run lint: `npm run lint`
- Run type checks: `npm run check-types`
- Run unit tests: `npm test`
- Run e2e tests: `npm run test:e2e`
- Run Storybook: `npm run storybook`

## Change Guidance
- Pages render in the browser; data comes from the Go API. Add server logic in `internal/`, not in `src/`.
- For API changes, validate inputs at the boundary and keep auth requirements intact.
- For database changes, update `src/models/Schema.ts` first, generate the migration with `npm run db:generate`, then `make gen`.
- For settings, billing, and authentication flows, verify redirects and Clerk integration points carefully.
- For weather or analytics features, avoid changing derived calculations without understanding downstream dashboard usage.

## Validation
- Prefer targeted validation first: run the smallest relevant lint, type-check, or test command for the files changed.
- If you change UI behavior, add or update tests when there is an existing nearby pattern.
- Do not fix unrelated failing tests as part of a focused task.

## Environment Notes
- Node.js 26+ (see `.nvmrc`) and Go 1.27 (see `go.mod`) are required.
- Runtime configuration is validated in `internal/config`; `NEXT_PUBLIC_*` values are inlined into the frontend at build time.
- Key integrations include Clerk, Stripe, OpenWeatherMap, and optional hosted Postgres.

## Avoid
- Do not commit build output, coverage artifacts, or dependency directories.
- Do not remove localization structure or flatten locale-aware routes.
- Do not add broad formatting-only churn unless the task explicitly asks for it.
