<p align="center">
  <a href="https://migraine.club">
    <img src="docs/readme/banner.svg" alt="Migraine Club — evidence-first migraine diary" width="100%" />
  </a>
</p>

<p align="center">
  <a href="https://migraine.club"><strong>migraine.club</strong></a>
  &nbsp;·&nbsp;
  <a href="#features">Features</a>
  &nbsp;·&nbsp;
  <a href="#getting-started">Getting started</a>
  &nbsp;·&nbsp;
  <a href="#architecture">Architecture</a>
  &nbsp;·&nbsp;
  <a href="docs/MCP_SERVER.md">MCP server</a>
</p>

<p align="center">
  <a href="https://github.com/denysovkos/migraine.club/actions/workflows/CI.yml"><img src="https://github.com/denysovkos/migraine.club/actions/workflows/CI.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white" alt="Go 1.27" />
  <img src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/Postgres-sqlc-4169E1?logo=postgresql&logoColor=white" alt="Postgres with sqlc" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license" />
</p>

# Migraine Club

**Migraine Club** (product name: **Migrennity**) is a migraine and headache diary that runs as an installable web app. It is built around one constraint: logging has to work while you are in pain. An attack needs only a pain level and a start time, and everything else can be added later.

From that diary the app produces the numbers a neurologist asks for, such as monthly migraine days, acute medication days and questionnaire scores, and packages them into a report you can hand over or share by link.

It does not diagnose, recommend treatment or predict attacks. It summarises what you entered and shows how much data each figure rests on.

<p align="center">
  <img src="docs/readme/how-it-works.svg" alt="How it works: log an attack, understand the pattern, share with your doctor" width="100%" />
</p>

## Features

| Area | What it does |
| --- | --- |
| **Attack logging** | Quick log with pain level and start time, ongoing attacks, symptoms, pain location, triggers, protectors and notes. A floating quick-add button covers attacks, notes and sleep. |
| **Daily diary** | Every local calendar day is a headache day, a headache-free day or missing. A missing day is never counted as a good day. See [docs/DAILY_DIARY.md](docs/DAILY_DIARY.md). |
| **Acute medications** | Doses with response outcomes, a timing report, and medication-overuse status based on ICHD-3 thresholds. |
| **Preventive treatments** | Plans with schedules and a one-tap daily check-in: taken, missed or not sure. No streaks. See [docs/PREVENTIVE_TREATMENTS.md](docs/PREVENTIVE_TREATMENTS.md). |
| **Outcomes** | Monthly Migraine Days, Monthly Headache Days and Acute Medication Days, charted against a baseline. |
| **Questionnaires** | HIT-6, MIDAS and MSQ scoring with history and trends. |
| **Insights** | Associations between factors and attacks, shown only when there is enough data, with confidence and coverage and a false-discovery-rate correction. |
| **Weather Pain Index** | Pressure, humidity and temperature trends from OpenWeatherMap plus the geomagnetic Kp index. Presented as context, not a forecast of attacks. |
| **Cycle tracking** | Optional menstrual cycle context for attacks. |
| **Programs** | Guided self-management programs with daily prompts and progress. |
| **Reports and sharing** | Clinician report (PDF), appointment prep, and tokenised share links with an expiry and a chosen date range. |
| **Community** | Moderated posts with anonymous posting and verified-doctor replies. |
| **Notifications** | Web Push for daily risk alerts, medication and program reminders, and stale ongoing attacks. See [docs/PUSH_NOTIFICATIONS.md](docs/PUSH_NOTIFICATIONS.md). |
| **AI connector** | An MCP server that lets Claude, ChatGPT and other clients read your history and log entries for you. See [docs/MCP_SERVER.md](docs/MCP_SERVER.md). |
| **PWA and offline logging** | Installable on iOS, Android and desktop. Attacks, doses and diary entries logged offline are kept on the device and synced in order when the connection returns, with their original times. See [docs/OFFLINE_LOGGING.md](docs/OFFLINE_LOGGING.md). |
| **Languages** | English, French and Ukrainian. |

## Tech stack

| Layer | Choice |
| --- | --- |
| Server | Go 1.27 (chi, pgx, sqlc): the API, the MCP endpoint, scheduled jobs, push delivery, and the frontend's pages |
| Frontend | React 19 and TypeScript 6, built with Vite into a single-page app; pages and layouts live in `src/app` |
| Styling | Tailwind CSS 4, shadcn/ui components on Radix |
| Auth | Clerk, which is also the OAuth 2.1 server for the MCP endpoint |
| Database | Postgres, queries through sqlc ([`internal/db/queries`](internal/db/queries)), 40+ migrations in [`migrations/`](migrations), schema authored in `src/models/Schema.ts` with drizzle-kit |
| Billing | Stripe |
| i18n | next-intl in the browser, locale routing in the Go server (`internal/spa`), routes under `src/app/[locale]` |
| Charts and PDF | Recharts, `@react-pdf/renderer` |
| Validation | Zod in the frontend; the server ports the same schemas (`internal/zod`), env validated in `internal/config` |
| Notifications | Web Push with VAPID keys (`internal/service/push`), service worker in `public/sw.js` |
| Observability | Sentry in the browser (tunnelled through `/monitoring`), structured logs to Better Stack (Logtail) |
| Testing | Go tests (with a throwaway Postgres), Vitest and React Testing Library, Playwright for end-to-end |

## Architecture

```mermaid
flowchart LR
    subgraph Clients
        PWA[Web app / PWA]
        AI[AI client<br/>Claude, ChatGPT]
        Cron[Scheduler]
    end

    subgraph Go["Go server (cmd/server)"]
        SPA["internal/spa<br/>pages, locale routing"]
        API["internal/api<br/>REST handlers, cron endpoints"]
        MCP["internal/mcp<br/>MCP tools"]
        SVC["internal/service<br/>domain logic"]
        DBQ["internal/db<br/>sqlc queries"]
    end

    WEB["web/ + src/<br/>React pages (Vite build)"]

    PWA --> SPA
    SPA -.->|serves| WEB
    PWA --> API
    AI --> MCP
    Cron --> API
    API --> SVC
    MCP --> SVC
    SVC --> DBQ
    DBQ --> DB[(Postgres)]
    SVC --> EXT[OpenWeatherMap<br/>NOAA Kp index]
    API -.->|auth| Clerk[Clerk]
    MCP -.->|"OAuth 2.1"| Clerk
```

The REST routes and the MCP tools are thin: they validate input and call the same services. An attack logged through an AI client therefore goes through the same rules as one logged in the app, including the one-ongoing-attack rule, the diary day recompute and medication-overuse dose counting.

### Repository layout

```
cmd/server/       The server binary
internal/
  api/            REST handlers, cron endpoints
  mcp/            MCP endpoint and tools
  service/        Domain services shared by REST and MCP
  spa/            Serves the frontend build: heads, locale routing, redirects
  db/             Migrations runner, sqlc queries (queries/) and generated code (q/)
  auth/           Clerk sessions, OAuth tokens, e2e mock auth
  server/         Routing and Next-compatible URL handling
web/              Vite app that renders the pages in src/app (router, shims)
src/
  app/            Pages and layouts ([locale]/ for the localised UI)
  features/       Feature UI and client logic (episodes, diary, insights, ...)
  locales/        en.json, fr.json, uk.json (also embedded in the server)
  models/         Schema (drizzle-kit) and shared types
migrations/       SQL migrations, embedded in the server
content/          Program texts, embedded in the server
tests/            Playwright e2e specs and fixtures
scripts/          Seeding and maintenance scripts
docs/             Feature notes
```

### Main routes

| Route | Purpose |
| --- | --- |
| `/` , `/product`, `/community`, `/mcp`, `/install` | Public pages |
| `/dashboard` | Today view with Weather Pain Index |
| `/dashboard/episodes` | Attack list, new attack, attack detail |
| `/dashboard/diary` | Daily diary |
| `/dashboard/insights` | Insights and the insights report |
| `/dashboard/outcomes` | Outcome metrics and acute medication report |
| `/dashboard/questionnaires` | HIT-6, MIDAS, MSQ |
| `/dashboard/reports` | Clinician report and appointment prep |
| `/dashboard/programs` | Programs library and progress |
| `/dashboard/community` | Community feed |
| `/dashboard/settings/*` | Account, profile, medications, treatments, cycle, location, notifications, privacy, modules |
| `/share/[token]` | Read-only shared report |
| `/api/mcp` | MCP server (streamable HTTP) |

## Getting started

### Prerequisites

- Node.js 26 or newer (see `.nvmrc`; CI uses 26)
- A Postgres database. Any Postgres works; production runs on Neon.
- A [Clerk](https://clerk.com) application
- [Stripe](https://stripe.com) test keys. They are required by env validation even if you do not touch billing.
- Optional: an [OpenWeatherMap](https://openweathermap.org/api) API key for the Weather Pain Index

### Install

```bash
git clone git@github.com:denysovkos/migraine.club.git
```

```bash
cd migraine.club
```

```bash
npm install
```

### Environment

Create `.env.local` in the project root. The server validates its variables on start (`internal/config`) and will not start if a required one is missing. `NEXT_PUBLIC_*` values are also inlined into the frontend when it is built.

```bash
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/migraine
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
BILLING_PLAN_ENV=dev            # dev | test | prod

# Optional
NEXT_PUBLIC_APP_URL=http://localhost:3000
OPENWEATHERMAP_API_KEY=         # enables the Weather Pain Index
VAPID_PRIVATE_KEY=              # Web Push, see docs/PUSH_NOTIFICATIONS.md
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_SUBJECT=
CRON_SECRET=                    # protects /api/cron/*
RUN_MIGRATIONS_ON_BOOT=         # set to "false" to skip startup migrations
FILES_STORAGE_PATH=             # doctor verification uploads
LOGTAIL_SOURCE_TOKEN=
```

`DATABASE_URL` is marked optional in the schema, but the app has no fallback database, so set it.

### Run

Go 1.27 and Node 26 are needed.

```bash
npm run dev:server   # the Go server on :3000 (reads .env*)
npm run dev          # the frontend with hot reload on :3002, API calls go to :3000
```

Open http://localhost:3002. Pending migrations are applied when the server starts. To run the production build locally: `npm run build && npm start`, then open http://localhost:3000.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Frontend dev server (Vite) |
| `npm run dev:server` | Go server |
| `npm run build` | Production build: the frontend into `web/dist`, the server into `bin/server` |
| `npm start` | Run the production build |
| `make test` / `make lint` | Go tests (set `TEST_DATABASE_URL` for the database-backed ones) and golangci-lint |
| `make gen` | Regenerate the schema snapshot and the sqlc query layer |
| `npm run lint` | ESLint |
| `npm run check-types` | TypeScript check |
| `npm test` | Unit and component tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end tests with mocked auth |
| `npm run db:generate` | Generate a migration after a schema change (then `make gen`) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed reference data, including the medication catalogue |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run commit` | Commitizen prompt for a conventional commit |

`db:migrate`, `db:seed` and `db:studio` read `.env.production`.

## Testing

Go tests sit next to the code as `*_test.go`; the database-backed ones create a throwaway database from `TEST_DATABASE_URL`. Frontend unit and component tests sit next to the code they cover as `*.test.ts(x)`. They do not read `.env`, so they need no secrets.

End-to-end tests are in [`tests/e2e`](tests/e2e) and run against a mocked Clerk session (`E2E_MOCK_AUTH=true`). Seed and reset the e2e database with `npm run e2e:seed` and `npm run e2e:reset`.

## AI connector (MCP)

The app exposes an MCP server at `/api/mcp` so a user can connect an AI client to their own account. Clerk handles OAuth 2.1, and access is split into two scopes:

| Scope | Tools |
| --- | --- |
| `migraine:read` | `get_user_context`, `list_attacks`, `list_medication_doses`, `get_diary`, `get_insights`, `get_moh_status`, `get_clinician_report`, `list_appointment_preps`, `get_appointment_prep` |
| `migraine:write` | `log_attack`, `update_attack`, `log_medication_dose`, `update_diary_day`, `log_factor` |

There are no delete tools. Every call is audited without storing arguments or payloads. Setup, including the Clerk dashboard configuration it depends on, is in [docs/MCP_SERVER.md](docs/MCP_SERVER.md).

## Privacy and data handling

- Episode and diary data is treated as sensitive health data. Logs carry IDs and coarse metrics, never medical details.
- Every personal-data endpoint requires authentication. Share links are tokenised, scoped to a date range and expire.
- Health-data consent is recorded explicitly, and writes through the MCP server fail without it.
- Weather context is optional and only computed once a location is set.
- Account deletion and self-service data export are available from privacy settings. `GET /api/user/export?format=json` returns every user-owned record in one file; `format=csv` returns a ZIP with one CSV per table. Share-link tokens, push keys, payment-provider IDs and staff-only moderation fields are left out. When adding a user-scoped table, add it to `Tables` in `internal/service/dataexport/dataexport.go`.

## Internationalisation

All UI copy lives in `src/locales`. `en.json` is the source of truth; `fr.json` and `uk.json` follow it. Do not hardcode user-facing strings. `scripts/scan-i18n.mjs` finds missing keys.

## Deployment

The app ships as one Docker image ([`Dockerfile`](Dockerfile)): the Go binary and the frontend build. Pass the `NEXT_PUBLIC_*` variables as build arguments (they are inlined into the frontend) and everything else as runtime environment, point `DATABASE_URL` at hosted Postgres, and set `NEXT_PUBLIC_APP_URL` to the public URL so metadata and the sitemap are correct. Migrations run once per server process on boot under an advisory lock, so a rolling deploy is safe. The image runs as root so it can write to a persistent disk mounted for `FILES_STORAGE_PATH`; the server listens on `PORT`.

Without Docker (a native Node service, as on Render): the build needs Go next to Node. Build command `curl -fsSL https://go.dev/dl/go1.27.4.linux-amd64.tar.gz | tar -xz -C /tmp && export PATH=/tmp/go/bin:$PATH && npm ci && npm run build`, start command `npm run start` (the Go binary serving `web/dist`).

Scheduled work is exposed as HTTP endpoints under `/api/cron/*` (daily risk, insights, medication reminders, program reminders, solar activity, stale-attack reminders). Call them from your scheduler with `CRON_SECRET`.

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org) and are checked by commitlint. A Husky pre-commit hook runs lint-staged. Guidance for AI coding agents is in [AGENTS.md](AGENTS.md).

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

Started from the [ixartz SaaS Boilerplate](https://github.com/ixartz/SaaS-Boilerplate) and rebuilt around migraine tracking.
