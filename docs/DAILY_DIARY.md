# Daily diary (Feature F37) — semantics & policy

## Semantics (non-negotiable)

For each user and each **local calendar date** (in the user’s timezone), the day is **exactly one** of:

1) **Headache day**: a `daily_diary_entry` row exists with `status = 'headache'`
2) **Headache-free day**: a `daily_diary_entry` row exists with `status = 'no_headache'`
3) **Missing data**: **no row exists** for that date

**Missing is NOT headache-free.** We never treat “no entry” as “good day”.

## Backfill/editing policy (server-enforced)

To reduce recall bias, the server enforces a strict edit window:

- **Editable window**: **last 30 days (including today)** in the user’s timezone
- Older days are **read-only** and updates are rejected with an explicit error (`NOT_EDITABLE`)

## Timezone rules

- We do **not** use server timezone.
- Timezone resolution is centralized in `getUserTimezone(userId)`:
  - `user_outcome_settings.timezone` (if set)
  - else `user_weather_settings.timezone`
  - else `'UTC'`

Each diary row stores the timezone used at entry time (`daily_diary_entry.timezone`) for auditability.

## Episode overlap reconciliation

For metrics and reports:

- If **any episode overlaps** a local date, that date is treated as a **headache day** for metrics,
  even if the diary entry says `no_headache`.
- This is exposed as a **conflict** in the UI (the database is not silently rewritten).

## Coverage in outcomes

Outcomes calculations use conservative ranges:

- **Min headache days**: days with diary `headache` or episode-overlap evidence
- **Max headache days**: min + “unknown” days (missing diary and no episode evidence)

Reports show coverage explicitly: **Recorded days X/Y, Missing Z**.
