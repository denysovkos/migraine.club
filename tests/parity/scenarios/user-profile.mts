import type { Scenario } from '../run.mts';

const scenarios: Scenario[] = [
  {
    name: 'profile get and update',
    steps: [
      { name: 'get', path: '/api/user/profile' },
      { name: 'update', method: 'PUT', path: '/api/user/profile', body: { displayName: '  New Name  ', themePreference: 'dark', preferredLanguage: 'uk' } },
      { name: 'get2', path: '/api/user/profile' },
      { name: 'noop', method: 'PUT', path: '/api/user/profile', body: {} },
      { name: 'invalid', method: 'PUT', path: '/api/user/profile', body: { displayName: 'x', themePreference: 'system', preferredLanguage: 'de' } },
      { name: 'blank', method: 'PUT', path: '/api/user/profile', body: { displayName: '     ' } },
      { name: 'not-json', method: 'PUT', path: '/api/user/profile', rawBody: 'nope' },
    ],
  },
  {
    name: 'profile created on first read',
    sql: [`DELETE FROM "user" WHERE id = 'e2e_user_test_001'`],
    steps: [
      { name: 'get', path: '/api/user/profile', headers: { 'accept-language': 'fr-FR,fr;q=0.9' } },
    ],
  },
  {
    name: 'profile with empty name gets one',
    sql: [`UPDATE "user" SET display_name = '' WHERE id = 'e2e_user_test_001'`],
    steps: [{ name: 'get', path: '/api/user/profile' }],
  },
];

export default scenarios;
