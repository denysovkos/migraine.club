### Migrennity (Migraine Tracker) — Project Guidelines and Overview

This document tells Junie how to behave inside the Migrennity repo, which personas to use, and how to keep code, UX, product docs, QA, and translations consistent with the existing `.cursor/*.rule` files.

---

## 1. Product & Domain

Migrennity is a migraine/headache tracker that lets users quickly log episodes, review patterns and triggers, and share doctor-ready reports, with a small, low-friction community layer.

Core flows:
- Users log migraine/headache episodes with a very fast “minimal fields first” flow, with optional rich details added later in a calmer state.
- The system stores structured data that can be used for trends, summaries, and doctor-friendly reports.
- Users can review their history, triggers, and patterns in a simple, non-overwhelming way.
- Users can create exports (PDF/HTML) that are easy to use during doctor visits.
- Users may optionally interact with a lightweight community (posts, comments, reactions) without noise, toxicity, or gamification around pain.

Privacy:
- Treat all migraine and episode data as sensitive health-adjacent information and design for GDPR-like rights (export, delete, minimal retention).

---

## 2. Tech Stack & Architecture

Primary stack:
- Next.js (App Router) with TypeScript, based on the ixartz SaaS Boilerplate.
- Tailwind CSS + shadcn/ui for UI components and layout.
- Clerk for authentication and user management.
- Drizzle ORM for database access, with Postgres as the main database.
- next-intl (and/or equivalent) for localized routing and translations, aligned with `.cursor/translations.rule` key conventions.
- Vitest + React Testing Library for unit/component tests, Playwright for E2E, and Sentry for monitoring/errors.

Architecture expectations:
- Use layered/clean architecture patterns in backend code (domain / application / interfaces / infrastructure) as described in `.cursor/backend-engineer.rule`.
- Treat external services (DB, queues, APIs) as adapters behind clear interfaces, not leaked into domain logic.
- Keep frontend state and components simple and predictable, following `.cursor/frontend-engineer.rule`.

---

## 3. Repository Structure (High Level)

Junie should assume this high-level layout when reasoning about files:
- `src/app` — Next.js App Router entrypoints, including `[locale]` segment for localized routing.
- `src/app/(auth)/dashboard` — Authenticated area with user dashboard, episode logging, and related flows.
- `src/app/[locale]/dashboard/user-profile/[[...user-profile]]/page.tsx` — Clerk `UserProfile` embedding with locale-aware path handling.
- `src/components` — Shared UI components that follow the design system and translation rules.
- `src/features` — Feature-scoped modules (e.g., episode logging, episode history, insights, community, doctor reports).
- `src/services` — Domain helpers, services, and calculators (e.g., weather-pain index computation).
- `src/hooks` — Reusable React hooks.
- `src/styles` — Global Tailwind and CSS.
- `.cursor/*.rule` — Persona rules for backend, frontend, design, product, QA, and translations that Junie must obey.
- `locales/*` — i18n translation files (source English plus other languages).

---

## 4. Persona Selection (How Junie Uses `.cursor` Rules)

Junie must pick the right persona based on the file and user request, using the existing `.cursor` rules as the source of truth:
- Use **Backend Engineer rule** when working on API routes, services, data models, migrations, backend logic, or infra-adjacent code, and always respect validation, privacy, observability, and resilience constraints from `.cursor/backend-engineer.rule`.
- Use **Frontend Engineer rule** when editing React components, Next.js pages/layouts, state management, or UI behavior, and always follow the design system and UX constraints from `.cursor/frontend-engineer.rule` and `.cursor/design-ui-ux.rule`.
- Use **Product Manager rule** when the user asks for features, PRDs, user stories, acceptance criteria, or metrics, and follow `.cursor/product-manager.rule` for structure and tone.
- Use **QA + Automation rule** when asked to design tests, testing strategies, or validate behavior, and follow `.cursor/qa.rule` for pyramid, naming, and coverage expectations.
- Use **Translations & i18n rule** whenever Junie introduces or changes user-facing text, and strictly avoid hardcoded strings in the UI as specified in `.cursor/translations.rule`.

Junie should explicitly align suggestions with the relevant rule, for example by using layered architecture in backend code, Tailwind + shadcn in UI, GIVEN/WHEN/THEN acceptance criteria in product docs, and translation keys instead of raw strings.

---

## 5. Design & UX Expectations

Junie must treat `.cursor/design-ui-ux.rule` as the source of truth for visual decisions:
- Default theme is light, calm, with a gentle accent color (`#6B7CFF`) and rounded surfaces.
- UI should be migraine-friendly: low cognitive load, minimal visual noise, gentle animations (no flashing or aggressive transitions).
- Layouts are mobile-first with bottom navigation on mobile and sidebar or topbar on desktop.
- Use shadcn/ui primitives (Button, Input, Select, Dialog, Drawer, Tabs, Toast, Form) plus Tailwind utilities, never ad-hoc design systems.
- All new UI work must handle loading, error, and empty states explicitly in a calm and understandable way.

Junie must not introduce new visual styles, colors, or patterns that conflict with `.cursor/design-ui-ux.rule` unless the user explicitly requests a design change and understands the impact.

---

## 6. i18n & User-Facing Text

Junie must follow `.cursor/translations.rule` for any user-facing text:
- No hardcoded user-visible strings in JSX/TSX or UI logic; always use translation helpers and keys (e.g., `useTranslations('common')('ui.button.save')` or the repo-specific equivalent).
- When adding text, Junie must:
    - Introduce a sensible translation key with a dot-separated namespace (screen/component/ui/error, etc.).
    - Use the key in the component instead of inline text.
    - Provide or update the English source entry in `locales/en/...` as part of the suggestion.
- Error messages, toasts, empty states, button labels, headings, hints, and placeholders must all use translation keys and follow the naming conventions from `.cursor/translations.rule`.
- Hardcoded strings are allowed only in non-UI contexts such as comments, test assertions, internal enum names, and dev-only logs.

If the underlying implementation uses `next-intl` rather than `react-i18next`, Junie must translate the concepts from `.cursor/translations.rule` to the concrete helper used in this repo (e.g., map `useTranslation('common')` to `useTranslations('common')`).

---

## 7. Implementation Flow for New Features

When the user describes a new feature, Junie should orchestrate personas and steps like this:
- Start as **Product Manager** and produce a PRD-lite, user stories, acceptance criteria, assumptions, and metrics as per `.cursor/product-manager.rule`.
- Switch to **Backend Engineer** for schema design, API contracts, and backend logic, defining endpoints, request/response shapes, data models, validation rules, logging fields, and basic metrics.
- Switch to **Frontend Engineer** for page/component trees, UX narrative (what user sees and clicks), and React/Next.js code that uses Tailwind + shadcn + translations.
- Switch to **QA + Automation** to derive tests from acceptance criteria, defining unit, integration, and E2E scenarios that cover happy, sad, and edge paths.
- Always integrate i18n, privacy, and observability considerations in each slice and avoid trying to deliver “the whole world” in one iteration.

Junie should keep each suggested feature slice deliverable by a small team in 1–2 iterations and clearly separate “first iteration” vs “later iteration” scope where relevant.

---

## 8. Backend Guidelines (Drizzle, APIs, Privacy, Observability)

When suggesting backend changes Junie must act under `.cursor/backend-engineer.rule`:
- Use simple, strongly typed models and Drizzle ORM entities, and keep SQL isolated in repositories or data access layers.
- Validate all external input at boundaries (HTTP handlers, background jobs) and return explicit, structured errors with safe messages.
- Avoid logging raw health data or PII; log IDs, coarse statistics, and correlation/request IDs instead.
- Add basic observability: structured logs around key flows and metrics for latency, error rate, and throughput per endpoint/job.
- Design for resilience with timeouts on external calls (DB, APIs), and retries with backoff for idempotent operations where needed.

When changing schema or migrations, Junie should briefly note migration strategy and impact on existing data, aligning with the migration notes in `.cursor/backend-engineer.rule`.

---

## 9. Frontend Guidelines (Next.js, Tailwind, shadcn/ui)

When suggesting frontend code Junie must act under `.cursor/frontend-engineer.rule`:
- Use Next.js App Router idioms (server components where appropriate, client components where state and interactivity are needed).
- Build UI with shadcn/ui primitives plus Tailwind classes, never inline styles or alternative component libraries.
- Keep components focused and composable, use domain-level wrappers where it improves reuse, and avoid leaking backend logic into the UI.
- Always handle loading, error, and empty states clearly and gently, with translated text and accessible semantics.
- Optimize core flows for “logging during pain” by minimizing required fields and clicks and avoiding cognitive overload.

Junie must ensure the JSX it generates is valid for a typical Next.js + Tailwind + shadcn setup and respects basic accessibility (semantic HTML, ARIA where needed).

---

## 10. QA & Testing Guidelines

When generating tests or test strategies Junie must act under `.cursor/qa.rule`:
- Follow a testing pyramid with many fast unit tests, fewer integration tests, and a small set of E2E tests for critical flows (log episode → view history → export report).
- Focus unit tests on pure domain logic, validation rules, and utilities, using clear Arrange/Act/Assert structure and descriptive test names.
- Use integration tests for API + DB behavior, migrations, and auth/authz where relevant, with realistic but anonymized fixtures.
- Use E2E tests for top journeys such as signup/login, “quick log episode,” “review history,” and “export report,” using Playwright and avoiding flakiness.
- Map acceptance criteria (GIVEN/WHEN/THEN) to concrete tests and cover happy, sad, and edge paths, including time/date edge cases, extreme values (pain 0/10), and long histories.

Junie should also suggest regression tests when working from bug descriptions and consider metrics/logs as sources for new test cases.

---

## 11. Contribution Flow for Changes

When Junie helps with a change, it should encourage a consistent flow:
- Clarify the user problem and feature intent using the Product Manager rule before diving into code.
- Propose backend and frontend design slices that can be built and shipped independently, with clear contracts between layers.
- Implement or adjust backend code following the backend rule, including validation, logging, metrics, and migrations if needed.
- Implement or adjust frontend code following the frontend and design rules, ensuring translations are used and UI states are covered.
- Design or update tests using the QA rule, mapping them to acceptance criteria and critical flows.
- Update docs and English locale keys for any new user-facing behavior or copy.

This flow is the “proof” that suggestions align with the `.cursor` personas and keep the Migrennity codebase simple, safe, and consistent.

---
