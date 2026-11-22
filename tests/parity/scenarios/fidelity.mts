import type { Scenario } from '../run.mts';

// Edge inputs for routes ported before the fidelity helpers existed: dates
// that V8 rolls over or rejects, ids Postgres rejects, and malformed JSON
// whose SyntaxError text the 500 bodies exposed.
const BAD_JSON = '{"a":1,}';

const scenarios: Scenario[] = [
  {
    name: 'fidelity: dates, ids and malformed bodies',
    steps: [
      { name: 'episodes-huge-page', path: '/api/episodes?page=10000000000&limit=20' },
      { name: 'episodes-huge-limit', path: '/api/episodes?limit=3000000000' },
      { name: 'episodes-bigint-page', path: '/api/episodes?page=99999999999999999999' },
      { name: 'episodes-nan-page', path: '/api/episodes?page=x&limit=-4' },
      { name: 'episode-id-huge', path: '/api/episodes/99999999999999999999' },
      { name: 'episodes-recent-huge', path: '/api/episodes/recent?limit=99999999999999999999' },
      { name: 'wpi-history-huge', path: '/api/weather-pain-index/history?days=99999999999999999999' },
      { name: 'diary-day-rollover', path: '/api/diary/day?date=2026-02-30' },
      { name: 'diary-day-month13', path: '/api/diary/day?date=2026-13-01' },
      { name: 'diary-range-rollover', path: '/api/diary/range?from=2026-02-27&to=2026-02-31' },
      { name: 'diary-range-month13', path: '/api/diary/range?from=2026-13-01&to=2026-13-05' },
      { name: 'diary-overlap-rollover', path: '/api/diary/overlap?from=2026-02-30&to=2026-03-02' },
      { name: 'diary-entry-rollover', method: 'PUT', path: '/api/diary/entry', body: { localDate: '2026-11-31', patch: { dayType: 'migraine_day' } } },
      { name: 'diary-entry-month13', method: 'PUT', path: '/api/diary/entry', body: { localDate: '2026-13-01', patch: { dayType: 'migraine_day' } } },
      { name: 'diary-entry-bad-json', method: 'PUT', path: '/api/diary/entry', rawBody: BAD_JSON },
      { name: 'factors-options-rollover', path: '/api/factors/options?localDate=2026-02-30' },
      { name: 'cycle-context-rollover', path: '/api/cycle/context?date=2026-02-30' },
      { name: 'cycle-calendar-rollover', path: '/api/cycle/calendar?from=2026-02-30&to=2026-03-31' },
      { name: 'cycle-bleeding-rollover', method: 'PUT', path: '/api/cycle/bleeding', body: { localDate: '2026-02-30', bleeding: true } },
      { name: 'cycle-bleeding-month13', method: 'PUT', path: '/api/cycle/bleeding', body: { localDate: '2026-13-01', bleeding: true } },
      { name: 'cycle-settings-bad-json', method: 'PUT', path: '/api/cycle/settings', rawBody: BAD_JSON },
      { name: 'episode-id-huge', path: '/api/episodes/99999999999' },
      { name: 'episode-id-fraction', path: '/api/episodes/1.5' },
      { name: 'episode-id-negative', path: '/api/episodes/-1' },
      { name: 'episode-patch-huge', method: 'PATCH', path: '/api/episodes/99999999999', body: { intensity: 3 } },
      { name: 'episode-patch-bad-json', method: 'PATCH', path: '/api/episodes/1', rawBody: BAD_JSON },
      { name: 'episode-delete-huge', method: 'DELETE', path: '/api/episodes/99999999999' },
      { name: 'episodes-post-bad-json', method: 'POST', path: '/api/episodes', rawBody: BAD_JSON },
      { name: 'episodes-post-empty', method: 'POST', path: '/api/episodes', rawBody: '' },
      { name: 'episodes-list-bad-range', path: '/api/episodes?from=2026-02-30&to=2026-13-01' },
      { name: 'acute-doses-bad-json', method: 'POST', path: '/api/acute-doses', rawBody: BAD_JSON },
      { name: 'dose-outcomes-bad-json', method: 'POST', path: '/api/dose-outcomes', rawBody: BAD_JSON },
      { name: 'quick-add-intake-bad-json', method: 'POST', path: '/api/quick-add/medication-intake', rawBody: BAD_JSON },
      { name: 'quick-add-episode-bad-json', method: 'POST', path: '/api/quick-add/episode', rawBody: BAD_JSON },
      { name: 'relief-bad-json', method: 'POST', path: '/api/relief-sessions', rawBody: BAD_JSON },
      { name: 'relief-bad-episode', method: 'POST', path: '/api/relief-sessions', body: { episodeId: 99999999999 } },
      { name: 'user-meds-bad-json', method: 'POST', path: '/api/user-medications', rawBody: BAD_JSON },
      { name: 'user-meds-patch-bad-id', method: 'PATCH', path: '/api/user-medications/abc', body: { isPinned: true } },
      { name: 'factors-log-bad-json', method: 'POST', path: '/api/factors/log', rawBody: BAD_JSON },
      { name: 'consent-bad-json', method: 'POST', path: '/api/user/consent', rawBody: BAD_JSON },
      { name: 'profile-bad-json', method: 'PATCH', path: '/api/user/profile', rawBody: BAD_JSON },
      { name: 'weather-settings-bad-json', method: 'PUT', path: '/api/weather-settings', rawBody: BAD_JSON },
      { name: 'wpi-history-rollover', path: '/api/weather-pain-index/history?from=2026-02-30&to=2026-03-02' },
      { name: 'pain-readings-huge', path: '/api/episodes/99999999999/pain-readings' },
      { name: 'pain-readings-post-huge', method: 'POST', path: '/api/episodes/99999999999/pain-readings', body: { intensity: 3 } },
      { name: 'relief-list-huge', path: '/api/relief-sessions?episodeId=99999999999' },
      { name: 'quick-add-intake-huge-episode', method: 'POST', path: '/api/quick-add/medication-intake', body: { customName: 'X', episodeId: 99999999999 } },
      { name: 'acute-dose-huge-attack', method: 'POST', path: '/api/acute-doses', body: { medicationId: '11111111-1111-4111-8111-111111111111', attackId: 99999999999 } },
      { name: 'bom-body', method: 'POST', path: '/api/preventives', rawBody: '﻿{"name":"B","kind":"oral","scheduleType":"daily","startDate":"2030-01-01"}', volatile: ['id'] },
    ],
  },
];

export default scenarios;
