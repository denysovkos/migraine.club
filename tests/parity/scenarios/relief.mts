import type { Scenario } from '../run.mts';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const scenarios: Scenario[] = [
  {
    name: 'relief sessions',
    seeds: ['e2e:seed', 'e2e:seed:relief'],
    steps: [
      { name: 'list', path: '/api/relief-sessions' },
      { name: 'add', method: 'POST', path: '/api/relief-sessions', body: { exercise: 'breathing', startedAt: ago(5), durationSeconds: 180, completed: true, helped: 'yes' } },
      { name: 'add-stopped', method: 'POST', path: '/api/relief-sessions', body: { exercise: 'pmr', startedAt: ago(3), durationSeconds: 20, completed: false, helped: null, episodeId: null } },
      { name: 'add-future', method: 'POST', path: '/api/relief-sessions', body: { exercise: 'pmr', startedAt: ago(-60), durationSeconds: 20, completed: true } },
      { name: 'add-bad-episode', method: 'POST', path: '/api/relief-sessions', body: { exercise: 'pmr', startedAt: ago(1), durationSeconds: 20, completed: true, episodeId: 999999 } },
      { name: 'add-invalid', method: 'POST', path: '/api/relief-sessions', body: { exercise: 'yoga', durationSeconds: 99999, completed: 'yes' } },
      { name: 'add-notjson', method: 'POST', path: '/api/relief-sessions', rawBody: '{' },
      { name: 'list2', path: '/api/relief-sessions' },
      { name: 'list-bad', path: '/api/relief-sessions?episodeId=0' },
      { name: 'list-none', path: '/api/relief-sessions?episodeId=999999' },
    ],
  },
];

export default scenarios;
