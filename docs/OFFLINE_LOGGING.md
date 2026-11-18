# Offline logging and background sync

Attacks, medication doses and diary entries can be logged without a connection. They are stored on the device and synced, in the order they were logged, once the connection is back. Nothing is lost if the app is closed in between.

## What works offline

| Action | Where | Endpoint replayed |
| --- | --- | --- |
| Start an attack | Dashboard "Start attack", diary editor | `POST /api/quick-add/episode` |
| Log or edit an attack with the full form | `/dashboard/episodes/new`, attack detail | `POST /api/episodes`, `PATCH /api/episodes/:id` |
| End the ongoing attack | Today timeline | `PATCH /api/episodes/:id` (`endNow` + `endedAt`) |
| Record the pain level within an attack | Attack mode "Pain level", pain timeline on the attack page | `POST /api/episodes/:id/pain-readings` (`intensity` + `recordedAt`) |
| Take a medication | Take-medication sheet, Quick kit | `POST /api/quick-add/medication-intake`, `POST /api/acute-doses` |
| Diary day type, notes, sleep, pain-free | Check-in card, diary, notes | `PUT /api/diary/entry` |
| Triggers and protectors | Attack form, factor logger | `POST /api/factors/log` |

Pages and data the user has opened online before are available offline. A page that was never opened falls back to the dashboard home, which has the quick-log sheet. Reports, insights and other reads stay online-only. Attack mode (`/quick/attack`, the dim three-button screen) is cached the same way as dashboard pages, so it opens offline once it has been visited. It shows its own quiet "saved on this device" status instead of the sync pill.

## How it works

```
 tap "log"  ──► sendOrQueue() ──online──► API ──► 2xx: done
                    │  offline / network error / timeout
                    ▼
            IndexedDB outbox (mc-offline/outbox)
                    │  'online', app focus, every 60 s, "Sync now",
                    │  or Background Sync while the app is closed
                    ▼
            flushOutbox() / sw.js replayOutbox()  ──► same API, same Idempotency-Key
```

**Client** (`src/libs/offline/outbox.ts`). `sendOrQueue` tries the request with a 15 s timeout. On a network error, a timeout, or when the device reports offline, it stores the request in IndexedDB and returns `{ queued: true }`. The UI then shows "Saved on this device". While earlier entries are still waiting, new writes join the queue instead of overtaking them.

**Replay**. Entries are sent strictly in capture order:

| Response | Effect |
| --- | --- |
| 2xx | Removed from the queue |
| network error | Stop, try again later |
| 5xx, 408, 425, 429, `IDEMPOTENCY_IN_PROGRESS` | Stop, try again later. After 8 attempts the entry is marked as failed |
| 401 | Stop and keep everything. The user needs to sign in again |
| `OFFLINE_USER_MISMATCH` | Stop. The entry belongs to another account on this device |
| other 4xx (validation, consent, `ONGOING_EXISTS`) | Marked as failed, replay continues with the next entry |

Stopping on transient errors keeps the order intact, so a dose taken during an attack is never sent before the attack itself.

**Service worker** (`public/sw.js`). On browsers with Background Sync (Chrome, Edge, Android), the `mc-outbox-sync` tag replays the queue even after the app is closed. The SW copy of the replay logic mirrors `flushOutbox`, so keep the two in sync. Safari and Firefox don't support Background Sync, so there the queue flushes the next time the app is opened or regains focus. A Web Lock (`mc-outbox`) keeps the page and the SW from replaying at the same time.

## Server guarantees

**Idempotency** (`src/app/api/_helpers/idempotency.ts`, table `idempotent_request`). Every outbox write carries `Idempotency-Key` (the outbox entry id). The first request reserves the key, runs, and stores its 2xx response. A replay gets the stored response back with `Idempotent-Replayed: true` and creates nothing. Errors release the key so a retry can run. A reservation older than 2 minutes without a response is treated as abandoned. Requests without the header behave as before.

**Right account.** Each entry carries `X-Offline-User`, the Clerk user id that was signed in when it was captured. If a different account is signed in at sync time, the server answers `409 OFFLINE_USER_MISMATCH` and the entry waits for its owner.

**Real times, not sync times.** Queued payloads carry the time captured on the device:

- `startedAt` on quick-add attacks, `takenAt` on intakes and acute doses, `endedAt` with `endNow`. The attack form already sends explicit times.
- The server accepts these up to 7 days in the past. A time more than 5 minutes in the future is rejected, and a small skew is clamped to now. `endedAt` is never earlier than the attack's start.
- A dose synced late only auto-links to an ongoing attack that had already started when the dose was taken. `lastUsedAt` on a medication never moves backwards.
- `/api/diary/today` may come from the SW cache on a new day, so the client re-derives "today" from the device clock in the user's timezone (`reconcileTodayWithDeviceClock`).

The take-medication sheet now writes the intake and the acute dose in one request (`recordAcuteDose: true`), so a dose is a single queue entry.

## Privacy

The outbox and the SW caches (`migrennity-user-pages`, `migrennity-user-api`) hold the user's health data on the device. They are scoped as follows:

- Offline, Clerk's script can't load, so the last user confirmed online is kept in `localStorage` (`mc-offline-user`) to tag new entries.
- On a confirmed sign-out or account switch, the app posts `CLEAR_USER_DATA` to the SW. That deletes the cached pages and API responses. Queued entries are kept, tagged with their owner, and only sent for that owner.
- Only a short allowlist of read endpoints is cached: consent status and profile (which gate the dashboard), medications, quick-add suggestions, today's diary, recent attacks, factor options and MOH status. Writes and auth requests are never cached.

## UI

`OfflineSyncIndicator` (left out in attack mode via `OfflineSyncProvider showIndicator={false}`) shows a pill at the top of the dashboard only when there is something to say: offline, entries waiting, or entries that couldn't sync. Tapping it lists the entries on the device, with Retry and Discard for failed ones and a "Sync now" button. When a backlog drains, a snackbar confirms how many entries synced and the page data refreshes.

## Operations

- Migration `0040_offline_idempotency` adds `idempotent_request`. Rows can be pruned after about 30 days (`created_at` is indexed), and no job does this yet.
- Bumping `SW_VERSION` clears the old app cache. Build assets live in `migrennity-next-static`, which survives upgrades because the files are content-hashed.

## Automated tests

| Layer | File | What it pins down |
| --- | --- | --- |
| Outbox | `src/libs/offline/outbox.test.ts` | Queue/send decisions, FIFO replay, stop-on-transient, retry cap, per-user isolation, Web Lock, Background Sync registration, subscriber notifications |
| Service worker | `src/libs/offline/sw.test.ts` | Runs the real `public/sw.js` in a VM with fake IndexedDB/Cache Storage. Covers Background Sync replay (order, per-user blocking, retry semantics), caching strategies, offline fallbacks, cache wipe on sign-out and on upgrade |
| Idempotency | `src/app/api/_helpers/idempotency.test.ts` | Replay returns the stored response, in-flight 409, release on error or throw, account mismatch, capture-time window |
| Routes | `src/app/api/quick-add/*/route.test.ts`, `src/app/api/episodes/[id]/route.test.ts` | Device times honoured and validated, combined intake and acute dose, 400 instead of 500 for bad payloads, `endedAt` bounds |
| Services | `src/services/QuickAddService.test.ts`, `src/services/episodes/EpisodeService.test.ts` | A late dose links only to an attack that had started by then, `lastUsedAt` never moves backwards, end-time clamping |
| Client APIs and UI | `src/features/quickAdd/offlineApis.test.ts`, `src/features/offline/*.test.tsx`, `TakeMedicationSheet.test.tsx`, `TodayActions.offline.test.tsx`, `src/features/diary/diaryApi.offline.test.ts` | Payloads carry device time, queued results surface as "saved on this device", Undo removes queued entries, indicator states, provider user handling, stale cached "today" |
| End to end | `tests/e2e/OfflineLogging.e2e.ts` | In real Chromium against Postgres: offline logging survives reopening the app, syncs in order with original times, dedupes concurrent replays, refuses another account's entries, handles stale reservations, reviews rejected entries, and replays through Background Sync with the app closed |

## Testing manually

1. Open `/dashboard`, the diary and the take-medication sheet once while online.
2. In DevTools, go to Network and select Offline. Start an attack, take a medication, and mark a diary day.
3. The pill shows "Offline · 3 entries waiting to sync". Reload: the app still opens and the entries are still listed.
4. Go back online. The entries sync in order, the snackbar confirms, and the attack, dose and diary day show the times from step 2.
5. For Background Sync: queue an entry offline, close the tab, then go online. Under Application > Background services > Background sync, you can see the replay.
