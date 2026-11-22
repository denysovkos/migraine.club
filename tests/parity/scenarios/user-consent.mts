import type { Scenario } from '../run.mts';

const scenarios: Scenario[] = [
  {
    name: 'consent lifecycle',
    steps: [
      { name: 'list', path: '/api/user/consent' },
      { name: 'renew', method: 'POST', path: '/api/user/consent', body: { consentType: 'terms', version: '2.0' }, headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.2' } },
      { name: 'create', method: 'POST', path: '/api/user/consent', body: { consentType: 'analytics' } },
      { name: 'list2', path: '/api/user/consent' },
      { name: 'withdraw', method: 'DELETE', path: '/api/user/consent?type=analytics' },
      { name: 'withdraw-again', method: 'DELETE', path: '/api/user/consent?type=analytics' },
      { name: 'withdraw-bad', method: 'DELETE', path: '/api/user/consent?type=marketing' },
      { name: 'withdraw-missing', method: 'DELETE', path: '/api/user/consent' },
    ],
  },
  {
    name: 'consent validation',
    steps: [
      { name: 'bad-type', method: 'POST', path: '/api/user/consent', body: { consentType: 'marketing' } },
      { name: 'missing', method: 'POST', path: '/api/user/consent', body: {} },
      { name: 'wrong-version', method: 'POST', path: '/api/user/consent', body: { consentType: 'terms', version: 3 } },
      { name: 'not-json', method: 'POST', path: '/api/user/consent', rawBody: '{nope' },
    ],
  },
];

export default scenarios;
