import type { Scenario } from '../run.mts';

const now = `now() - interval '5 minutes'`;
const scenarios: Scenario[] = [
  {
    name: 'kp aggregate from snapshots',
    sql: [
      `DELETE FROM solar_activity_snapshot`,
      `INSERT INTO solar_activity_snapshot (timestamp_utc, kp_index, source, raw) VALUES
        (${now}, 2.67, 'noaa_now', '{"fetchedAt":"x","meta":{"sourceId":"noaa_1m","kp_index":3,"noaaScale":null},"raw":{"time_tag":"2025-12-20T10:25:00","kp_index":3,"estimated_kp":2.67}}'),
        (now() - interval '2 hours', 4.33, 'noaa_forecast', '{"meta":{"sourceId":"noaa_forecast","noaaScale":"G1"},"raw":["2025","4.33","observed","G1"]}'),
        (now() - interval '3 hours', 4, 'gfz', '{"meta":{"sourceId":"gfz_webservice","status":"def"},"raw":null}'),
        (now() - interval '30 hours', 6, 'nasa', null),
        (now() - interval '3 days', 5, 'gfz_laststorm', '{"lastStorm":{"startTime":"2025-12-18T00:00:00.000Z","endTime":"2025-12-18T06:00:00.000Z","peakKp":5,"peakTime":"2025-12-18T03:00:00.000Z"}}')`,
    ],
    steps: [{ name: 'kp', path: '/api/space-weather/kp' }],
  },
  {
    name: 'kp without data',
    sql: [`DELETE FROM solar_activity_snapshot`],
    steps: [{ name: 'kp', path: '/api/space-weather/kp' }],
  },
];

export default scenarios;
