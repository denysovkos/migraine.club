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
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/Postgres-Drizzle_ORM-4169E1?logo=postgresql&logoColor=white" alt="Postgres with Drizzle ORM" />
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
| **PWA** | Installable on iOS, Android and desktop. |
| **Languages** | English, French and Ukrainian. |

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript 6 |
| Styling | Tailwind CSS 4, shadcn/ui components on Radix |
| Auth | Clerk, which is also the OAuth 2.1 server for the MCP endpoint |
| Database | Postgres through Drizzle ORM, 40+ migrations in [`migrations/`](migrations) |
| Billing | Stripe |
| i18n | next-intl, routes under `src/app/[locale]` |
| Charts and PDF | Recharts, `@react-pdf/renderer` |
| Validation | Zod at every external boundary, env validated in `src/libs/Env.ts` |
| Notifications | `web-push` with VAPID keys, service worker in `public/sw.js` |
| Observability | Sentry, Pino, Logtail |
| Testing | Vitest and React Testing Library, Playwright for end-to-end |

## Architecture

```mermaid
flowchart LR
    subgraph Clients
        PWA[Web app / PWA]
        AI[AI client<br/>Claude, ChatGPT]
        Cron[Scheduled jobs]
    end

    subgraph Next["Next.js app"]
        UI["src/app/[locale]<br/>pages and layouts"]
        API["src/app/api<br/>REST handlers"]
        MCP["src/server/mcp<br/>MCP tools"]
        SVC["src/services<br/>domain logic"]
        REPO["src/repositories<br/>external adapters"]
        MODEL["src/models<br/>Drizzle schema"]
    end

    PWA --> UI
    PWA --> API
    AI --> MCP
    Cron --> API
    UI --> SVC
    API --> SVC
    MCP --> SVC
    SVC --> REPO
    SVC --> MODEL
    MODEL --> DB[(Postgres)]
    REPO --> EXT[OpenWeatherMap<br/>NOAA Kp index]
    API -.->|auth| Clerk[Clerk]
    MCP -.->|"OAuth 2.1"| Clerk
```

The REST routes and the MCP tools are thin: they validate input and call the same services. An attack logged through an AI client therefore goes through the same rules as one logged in the app, including the one-ongoing-attack rule, the diary day recompute and medication-overuse dose counting.

### Repository layout

```
src/
  app/            App Router pages, layouts and API routes
    [locale]/     Localised UI: (unauth) marketing pages, (auth) dashboard
    api/          REST handlers, cron endpoints, MCP endpoint
  features/       Feature UI and client logic (episodes, diary, insights, ...)
  services/       Domain services shared by REST and MCP
  server/         MCP tools, push delivery, space-weather sync
  repositories/   Adapters for external services
  models/         Drizzle schema and types
  locales/        en.json, fr.json, uk.json
  libs/           Env, DB, logger, i18n setup
migrations/       Drizzle SQL migrations
tests/            Playwright e2e and integration tests
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

- Node.js 20.9 or newer (22 is what CI uses)
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

Create `.env.local` in the project root. Variables are validated in [`src/libs/Env.ts`](src/libs/Env.ts) and the app will not start if a required one is missing.

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

```bash
npm run dev
```

Open http://localhost:3000. Pending migrations are applied when the server starts.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run check-types` | TypeScript check |
| `npm test` | Unit and component tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end tests with mocked auth |
| `npm run db:generate` | Generate a migration after a schema change |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed reference data, including the medication catalogue |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run commit` | Commitizen prompt for a conventional commit |

`db:migrate`, `db:seed` and `db:studio` read `.env.production`.

## Testing

Unit and component tests sit next to the code they cover as `*.test.ts(x)`. They do not read `.env`, so they need no secrets.

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
- Account deletion is available from privacy settings. Self-service data export is not built yet.

## Internationalisation

All UI copy lives in `src/locales`. `en.json` is the source of truth; `fr.json` and `uk.json` follow it. Do not hardcode user-facing strings. `scripts/scan-i18n.mjs` finds missing keys.

## Deployment

The app is a standard Next.js server. Set the required environment variables, point `DATABASE_URL` at hosted Postgres, and set `NEXT_PUBLIC_APP_URL` to the public URL so metadata and the sitemap are correct. Migrations run once per server process on boot under an advisory lock, so a rolling deploy is safe.

Scheduled work is exposed as HTTP endpoints under `/api/cron/*` (daily risk, insights, medication reminders, program reminders, solar activity, stale-attack reminders). Call them from your scheduler with `CRON_SECRET`.

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org) and are checked by commitlint. A Husky pre-commit hook runs lint-staged. Guidance for AI coding agents is in [AGENTS.md](AGENTS.md).

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

Started from the [ixartz SaaS Boilerplate](https://github.com/ixartz/SaaS-Boilerplate) and rebuilt around migraine tracking.
