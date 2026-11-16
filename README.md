# Migrennity (Migraine Tracker)

Migrennity is a migraine and headache tracker designed for low friction during pain and clear insights afterward. Log episodes fast with minimal fields, add rich details later, review patterns and triggers, and generate doctor‑ready summaries. A gentle, optional community layer enables low‑noise sharing without gamification around pain.

## Highlights

- Minimal fields first: log quickly when it hurts, enrich later.
- Structured data: consistent fields for intensity, location/type, symptoms, triggers, meds, notes.
- Weather Pain Index (WPI): optional weather and solar signals integrated into your dashboard and episodes.
- Privacy by default: sensitive, health‑adjacent data with export/delete in mind.

## Tech stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Auth: Clerk
- Database: Postgres via Drizzle ORM (PGlite for local fallback)
- i18n: next-intl with locale‑aware routing under [locale]
- Charts: Recharts
- Validation: Zod
- Monitoring: Sentry
- Testing: Vitest + React Testing Library; Playwright for E2E

## Repository structure (high level)

- src/app — Next.js App Router entries, localized under [locale]
- src/components — Shared UI (shadcn/ui)
- src/features — Feature modules (episodes, weather, dashboard, etc.)
- src/services — Domain services (e.g., WeatherPainIndexService)
- src/models — Drizzle schema and types
- src/repositories — Adapters for external services
- locales/* — Translation files
- tests — Unit/integration; Playwright e2e

## Routes

UI

- UI /[locale] - Public landing page
- UI /[locale]/sign-in - Sign in (Clerk; supports nested routes)
- UI /[locale]/sign-up - Sign up (Clerk; supports nested routes)
- UI /[locale]/dashboard - Dashboard overview with Weather
- UI /[locale]/dashboard/episodes - Episodes list
- UI /[locale]/dashboard/episodes/new - Log a new episode
- UI /[locale]/dashboard/episodes/[id] - View/edit an episode
- UI /[locale]/dashboard/community - Community feed
- UI /[locale]/dashboard/settings - Settings hub (redirects to /settings/account)
- UI /[locale]/dashboard/settings/account - User profile/account settings (Clerk UserProfile)
- UI /[locale]/dashboard/settings/location - Location and weather settings for WPI

API

- API /api/episodes - Create episode (POST) and list user episodes (GET, paginated)
- API /api/episodes/recent - Recent episodes (GET, optional ?limit)
- API /api/episodes/[id] - Get (GET), update (PATCH), delete (DELETE) a single episode
- API /api/user/weather-settings - Get (GET) and update (PUT) user weather settings
- API /api/weather-pain-index/current - Current Weather Pain Index for user (GET)
- API /api/weather-pain-index/forecast - Solar activity alert status (GET)
- API /api/weather-pain-index/history - Weather Pain Index history (GET, optional ?days)

## Core flows

- Quick log: intensity and start time required; mark ongoing if needed.
- Enrich later: add pain location/type, symptoms, triggers, medications, notes.
- Review dashboard: recent episodes, WPI with weather/solar context, and alerts.
- Configure settings: manage account (Clerk UserProfile), and location/weather for WPI.
- Export/report: planned slice for printable doctor summaries.

## Settings

The Settings section (`/dashboard/settings`) provides a centralized place for user preferences:

- **Account** (`/settings/account`): Clerk UserProfile for profile, email, password, and security settings. Styled to match the app's design system.
- **Location & Weather** (`/settings/location`): Configure location for personalized Weather Pain Index calculations.

After successful sign-in or sign-up, users are automatically redirected to the dashboard. This is configured in the ClerkProvider using `signInFallbackRedirectUrl` and `signUpFallbackRedirectUrl`.

## Privacy & data handling

- Treat episode data as sensitive; avoid logging PII. Logs include IDs and coarse metrics only.
- Authz: every personal data endpoint requires authentication.
- Weather context is optional; only computed when user settings exist.
- GDPR‑like posture: export and deletion are design goals.

## Getting started

Prerequisites

- Node.js 18+
- Clerk application (publishable + secret keys)
- Optional for production DB: Postgres connection string
- OpenWeatherMap API key (to enable WPI)

Install

```
npm install
```

Environment variables

Create a .env.local in the project root. The app validates env using src/libs/Env.ts.

Required (server)

- CLERK_SECRET_KEY=
- STRIPE_SECRET_KEY=
- STRIPE_WEBHOOK_SECRET=
- BILLING_PLAN_ENV=dev|test|prod

Optional (server)

- DATABASE_URL=  # If omitted in development, a local PGlite DB is used
- LOGTAIL_SOURCE_TOKEN=
- OPENWEATHERMAP_API_KEY=

Required (client)

- NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
- NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
- NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

Optional (client)

- NEXT_PUBLIC_APP_URL=
- NEXT_PUBLIC_SENTRY_DSN=

Database and migrations (Drizzle)

```
# Generate migrations after schema changes
npm run db:generate

# Apply migrations
npm run db:migrate

# Explore with Drizzle Studio (optional)
npm run db:studio
```

Run the app

```
npm run dev
```

Open http://localhost:3000. Most pages are localized under /[locale] (see src/utils/AppConfig.ts for defaults).

## Architecture notes

- App Router, server components by default; client components for interactivity/state.
- Layered backend: domain/services (src/services), repositories/adapters (src/repositories), schema (src/models), HTTP handlers (src/app/api).
- Input validation on all external boundaries with Zod; structured error responses.
- Observability: Pino logger and Sentry; avoid sensitive payloads in logs.

## Internationalization (i18n)

- next-intl with a [locale] segment in routes.
- Avoid hardcoded UI strings; add translation keys and update locales/en as the source of truth.

## Testing

- Unit: Vitest + React Testing Library
- E2E: Playwright

Commands

- npm test — unit tests
- npm run test:e2e — e2e tests

## Deployment

- Set all required env variables in your environment (Clerk, Stripe, BILLING_PLAN_ENV, etc.).
- Provide DATABASE_URL for hosted Postgres; migrations should be applied before traffic.
- On Vercel, set NEXT_PUBLIC_APP_URL to the public base URL for correct metadata and sitemap.

## License

MIT — see LICENSE.

## Acknowledgements

Originally based on the ixartz Next.js SaaS Boilerplate, adapted into Migrennity with domain‑specific features (episodes, Weather Pain Index, and localized UI).
