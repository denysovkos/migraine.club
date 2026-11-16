## F40 Preventive Treatments

This feature treats preventives as **plans**, not diaries. Users set up a plan once and then answer the daily prompt with a single tap: **Taken**, **Missed**, or **Not sure**.

### Core concepts

- **Plan-first**: one plan can be active for long periods; logging is lightweight.
- **No guilt UX**: no streaks; missing or “Not sure” never counts as missed.
- **Local dates**: all schedules and analytics use the user’s local day boundary.

### Schedule rules

- `daily`: due every day starting on `startDate`.
- `weekdays`: due Mon–Fri starting on `startDate`.
- `custom_weekdays`: due on selected weekdays (`schedulePayload = [1..7]`).
- `every_n_days`: due every `n` days from `startDate` (`schedulePayload = { n }`).
- `every_n_weeks`: due every `n` weeks on the `startDate` weekday (`schedulePayload = { n }`).
- `on_specific_dates`: due on specific dates (`schedulePayload = [YYYY-MM-DD]`).

**Injection/infusion forgiveness window**

For `every_n_weeks` plans with `kind = injection | infusion`, due is treated as a 3‑day window around the scheduled date. The plan is marked overdue only after the window ends.

### Dose reminders (F42)

The schedule above decides **which days** a dose falls on. `reminder_times`
decides **when during those days** — a list of user-local `HH:mm` slots (max 8),
gated by `reminders_enabled`. Both live on `preventive_plan`.

Slots sit on the **half hour** (`00:00`, `00:30`, … `23:30`), enforced by
`REMINDER_TIME_REGEX` on both write paths. The cron ticks every 30 minutes, so
minute precision promised an accuracy the delivery path never had: a `09:27`
slot could only ever be pushed at `09:30`.

`/api/cron/medication-reminders` pushes a Web Push notification for each slot
that has come due. Recommended schedule: **every 30 minutes**.

- **Firing rule**: a slot fires on the first tick at or after it. `isSlotDue`
  stays minute-agnostic so plans written before the half-hour rule still fire.
- **Late window**: a slot missed by a few ticks (deploy, outage) still fires up
  to 90 minutes late, then is dropped rather than pushed at the wrong time of day.
- **Idempotency**: `preventive_reminder_log` is unique on
  `(plan_id, local_date, time_slot)`. Re-running a tick, or running the cron more
  often than every 30 minutes, never double-notifies.
- **Suppression**: paused/stopped plans, days the plan is not scheduled, and days
  already logged as `taken` send nothing. Suppression is day-level: one `taken`
  event covers every slot on the plan that day.
- **Empty times**: `reminders_enabled` with no `reminder_times` is not
  actionable — the cron skips the plan entirely. Both edit surfaces refuse to
  save that combination.
- **Confirming**: the notification carries a **Taken** action that posts to
  `/api/preventives/intake` from the service worker, so the user never has to
  open the app. Tapping the body deep-links to the dashboard.

### “Not sure” handling

- “Not sure” is **excluded** from adherence and outcome calculations.
- Adherence is computed as:

```
adherence = taken / (taken + missed)
```

Only due days are included; “unsure” and non‑due days are excluded. Coverage is reported separately as the fraction of due days that have any response.

### Outcomes windows (per plan)

- **Baseline**: 28 days immediately before the plan `startDate`.
- **Ramp‑up**: first 14 days after `startDate` are excluded from comparisons.
- **Evaluation**: days 15–42 (28 days) and extended view for weeks 3–14 (84 days).
- If there is insufficient diary coverage in the evaluation window, the UI shows a “Not enough data yet” message with the missing days count.

Metrics (baseline and evaluation windows):

- **MMD**: migraine days (from daily diary).
- **MHD**: headache + migraine days (no double counting).
- **Acute medication days**: any acute med logged.
- **50% responder**: evaluation MMD ≤ 50% baseline MMD (matched window).

### Terminology

- Use “Attack” for episodes.
- Avoid medical claims; report associations, not causality.
