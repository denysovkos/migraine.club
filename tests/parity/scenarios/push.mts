import type { Scenario } from '../run.mts';

// Needs VAPID keys on both servers and the fake push service on :3099
// (see docs/migration/STATUS.md). Subscription keys are a valid P-256 pair.
const P256DH = 'BGGMAS8DUjSPoek9Mg4qH9GHwBOZF6CNMS_dpYCBelt1g8zcU1vuMnFW5YDjGikW1s_B_5mejO5AVHYAqCi1Ttw';
const AUTH = 'cdy0PYUyd7hjhQZ3dkAj3w';
const sub = (path: string) => ({ endpoint: `http://localhost:3099/${path}`, keys: { p256dh: P256DH, auth: AUTH }, expirationTime: null });

const scenarios: Scenario[] = [
  {
    name: 'push subscriptions',
    sql: [`DELETE FROM push_subscription WHERE endpoint LIKE 'http://localhost:3099/%'`],
    steps: [
      { name: 'test-none', method: 'POST', path: '/api/push/test' },
      { name: 'subscribe-invalid', method: 'POST', path: '/api/push/subscribe', body: { endpoint: 'nope', keys: { p256dh: '', auth: 1 }, expirationTime: 'x' } },
      { name: 'subscribe-missing-keys', method: 'POST', path: '/api/push/subscribe', body: { endpoint: 'https://x.example/1' } },
      { name: 'subscribe-bad-json', method: 'POST', path: '/api/push/subscribe', rawBody: '{' },
      { name: 'subscribe-fraction', method: 'POST', path: '/api/push/subscribe', body: { ...sub('frac'), expirationTime: 1.5 } },
      { name: 'subscribe-ok', method: 'POST', path: '/api/push/subscribe', body: sub('ok'), headers: { 'user-agent': 'ParityBrowser/1.0' } },
      { name: 'subscribe-ok-again', method: 'POST', path: '/api/push/subscribe', body: { ...sub('ok'), expirationTime: 1700000000000 } },
      { name: 'test-one', method: 'POST', path: '/api/push/test' },
      { name: 'subscribe-gone', method: 'POST', path: '/api/push/subscribe', body: sub('gone') },
      { name: 'subscribe-fail', method: 'POST', path: '/api/push/subscribe', body: sub('fail') },
      { name: 'test-mixed', method: 'POST', path: '/api/push/test' },
      { name: 'test-after-cleanup', method: 'POST', path: '/api/push/test' },
      { name: 'unsubscribe-invalid', method: 'POST', path: '/api/push/unsubscribe', body: { endpoint: 1 } },
      { name: 'unsubscribe-missing', method: 'POST', path: '/api/push/unsubscribe', body: { endpoint: 'https://x.example/none' } },
      { name: 'unsubscribe', method: 'POST', path: '/api/push/unsubscribe', body: { endpoint: 'http://localhost:3099/ok' } },
      { name: 'test-last', method: 'POST', path: '/api/push/test' },
    ],
  },
];

export default scenarios;
