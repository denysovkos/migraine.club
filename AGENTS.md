# AGENTS.md

## Scope
These instructions apply to the entire repository unless a deeper `AGENTS.md` overrides them.

## Project Summary
- Product: `migraine.club` / Migrennity, a migraine tracking application.
- Framework: Next.js App Router with TypeScript.
- Styling: Tailwind CSS with shadcn/ui-style components.
- Auth: Clerk.
- Data: Drizzle ORM with Postgres, with PGlite fallback in development.
- i18n: `next-intl` with locale-aware routing under `src/app/[locale]`.

## Working Rules
- Preserve the existing architecture; prefer small, localized changes over broad refactors.
- Treat migraine episode and user health-related data as sensitive; do not introduce logging of personal or medical details.
- Keep UI copy translatable. Avoid hardcoded user-facing strings when editing localized surfaces.
- Match the existing TypeScript, React, and Tailwind patterns already used in nearby files.
- Do not change environment-variable names or auth/billing behavior unless the task explicitly requires it.

## Repository Map
- `src/app`: App Router pages, layouts, and API routes.
- `src/app/[locale]`: localized UI routes.
- `src/components`: shared UI building blocks.
- `src/features`: feature-specific UI and logic.
- `src/services`: domain services and business logic.
- `src/repositories`: external service/data access adapters.
- `src/models`: Drizzle schema and related types.
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
- Start dev server: `npm run dev`
- Build production app: `npm run build`
- Run lint: `npm run lint`
- Run type checks: `npm run check-types`
- Run unit tests: `npm test`
- Run e2e tests: `npm run test:e2e`
- Run Storybook: `npm run storybook`

## Change Guidance
- For App Router work, check whether a component should stay server-side before adding `use client`.
- For API changes, validate inputs at the boundary and keep auth requirements intact.
- For database changes, update Drizzle schema first and only generate migrations when the task requires it.
- For settings, billing, and authentication flows, verify redirects and Clerk integration points carefully.
- For weather or analytics features, avoid changing derived calculations without understanding downstream dashboard usage.

## Validation
- Prefer targeted validation first: run the smallest relevant lint, type-check, or test command for the files changed.
- If you change UI behavior, add or update tests when there is an existing nearby pattern.
- Do not fix unrelated failing tests as part of a focused task.

## Environment Notes
- Node.js 18+ is required.
- Main runtime configuration is validated in `src/libs/Env.ts`.
- Key integrations include Clerk, Stripe, OpenWeatherMap, and optional hosted Postgres.

## Avoid
- Do not commit build output, coverage artifacts, or dependency directories.
- Do not remove localization structure or flatten locale-aware routes.
- Do not add broad formatting-only churn unless the task explicitly asks for it.
