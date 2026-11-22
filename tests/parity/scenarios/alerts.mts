import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;
const day = (offset: number) => `extract(epoch from date_trunc('day', now()) + interval '${offset} day' + interval '11 hour')::bigint`;

const scenarios: Scenario[] = [
  {
    name: 'alerts and pressure without location',
    sql: [`DELETE FROM user_weather_settings WHERE user_id = ${U}`],
    steps: [
      { name: 'alerts-none', path: '/api/user/alerts' },
      { name: 'alerts-put-none', method: 'PUT', path: '/api/user/alerts', body: { alertsEnabled: true } },
      { name: 'threshold-none', path: '/api/user/pressure-alert' },
      { name: 'threshold-put-none', method: 'PUT', path: '/api/user/pressure-alert', body: { thresholdHpa: 5 } },
      { name: 'outlook-none', path: '/api/weather/pressure-outlook' },
    ],
  },
  {
    name: 'alerts and pressure with location',
    sql: [
      `DELETE FROM user_weather_settings WHERE user_id = ${U}`,
      `INSERT INTO user_weather_settings (user_id, lat, lon, timezone) VALUES (${U}, 48.137, 11.575, 'Europe/Berlin')`,
      `DELETE FROM pressure_forecast_cache WHERE lat = 48.14 AND lon = 11.58`,
      `INSERT INTO pressure_forecast_cache (lat, lon, points, fetched_at) VALUES (48.14, 11.58, jsonb_build_array(
        jsonb_build_object('dt', ${day(-1)}, 'pressureHpa', 1021.3),
        jsonb_build_object('dt', ${day(0)}, 'pressureHpa', 1017.04),
        jsonb_build_object('dt', ${day(1)}, 'pressureHpa', 1010.96),
        jsonb_build_object('dt', ${day(2)}, 'pressureHpa', 1012),
        jsonb_build_object('dt', ${day(3)}, 'pressureHpa', 1004.55)), now())`,
    ],
    steps: [
      { name: 'alerts', path: '/api/user/alerts' },
      { name: 'alerts-put', method: 'PUT', path: '/api/user/alerts', body: { alertsEnabled: true } },
      { name: 'alerts-after', path: '/api/user/alerts' },
      { name: 'alerts-put-bad', method: 'PUT', path: '/api/user/alerts', body: { alertsEnabled: 'yes' } },
      { name: 'alerts-put-empty', method: 'PUT', path: '/api/user/alerts', body: {} },
      { name: 'outlook-default', path: '/api/weather/pressure-outlook' },
      { name: 'threshold', path: '/api/user/pressure-alert' },
      { name: 'threshold-put', method: 'PUT', path: '/api/user/pressure-alert', body: { thresholdHpa: 3.5 } },
      { name: 'threshold-after', path: '/api/user/pressure-alert' },
      { name: 'outlook-threshold', path: '/api/weather/pressure-outlook' },
      { name: 'threshold-low', method: 'PUT', path: '/api/user/pressure-alert', body: { thresholdHpa: 0.5 } },
      { name: 'threshold-high', method: 'PUT', path: '/api/user/pressure-alert', body: { thresholdHpa: 31 } },
      { name: 'threshold-str', method: 'PUT', path: '/api/user/pressure-alert', body: { thresholdHpa: '5' } },
      { name: 'threshold-missing', method: 'PUT', path: '/api/user/pressure-alert', body: {} },
      { name: 'threshold-raw', method: 'PUT', path: '/api/user/pressure-alert', rawBody: 'not json' },
      { name: 'threshold-null', method: 'PUT', path: '/api/user/pressure-alert', body: { thresholdHpa: null } },
      { name: 'threshold-final', path: '/api/user/pressure-alert' },
    ],
  },
];

export default scenarios;
