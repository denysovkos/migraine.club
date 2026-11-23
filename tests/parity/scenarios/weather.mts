import type { Scenario } from '../run.mts';

const scenarios: Scenario[] = [
  {
    name: 'weather settings and wpi',
    sql: [`DELETE FROM user_weather_settings WHERE user_id = 'e2e_user_test_001'`, `DELETE FROM weather_pain_index_snapshot WHERE user_id = 'e2e_user_test_001'`],
    steps: [
      { name: 'get-none', path: '/api/user/weather-settings' },
      { name: 'current-none', path: '/api/weather-pain-index/current' },
      { name: 'put', method: 'PUT', path: '/api/user/weather-settings', body: { lat: 52.52, lon: 13.405, locationLabel: 'Berlin', timezone: 'Europe/Berlin' } },
      { name: 'get', path: '/api/user/weather-settings' },
      { name: 'current', path: '/api/weather-pain-index/current' },
      { name: 'current-cached', path: '/api/weather-pain-index/current' },
      { name: 'history', path: '/api/weather-pain-index/history?days=5' },
      { name: 'history-bad', path: '/api/weather-pain-index/history?days=0' },
      { name: 'put-bad', method: 'PUT', path: '/api/user/weather-settings', body: { lat: 'x', lon: 200, timezone: '' } },
    ],
  },
  {
    name: 'solar forecast',
    sql: [`DELETE FROM solar_activity_snapshot`, `INSERT INTO solar_activity_snapshot (timestamp_utc, kp_index, source) VALUES (now() - interval '1 hour', 4.33, 'noaa')`],
    steps: [{ name: 'forecast', path: '/api/weather-pain-index/forecast' }],
  },
];

export default scenarios;
