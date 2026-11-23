import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;
const OTHER = `'parity_other_user'`;

// Rows in tables the e2e seed leaves empty, with values that exercise CSV
// quoting, formula escaping, jsonb key order and JS number formatting.
const extra = [
  `DELETE FROM community_post WHERE author_id = ${OTHER}`,
  `INSERT INTO "user" (id, display_name, stripe_customer_id) VALUES (${OTHER}, 'Other', 'cus_x') ON CONFLICT DO NOTHING`,
  `UPDATE "user" SET stripe_customer_id = 'cus_secret', display_name = 'E2E User' WHERE id = ${U}`,
  `INSERT INTO user_weather_settings (user_id, lat, lon, location_label, timezone) VALUES (${U}, 52.52, 13.405, '=HYPERLINK("x"), "quoted"', 'Europe/Berlin')
    ON CONFLICT (user_id) DO UPDATE SET location_label = EXCLUDED.location_label`,
  `INSERT INTO user_weather_settings (user_id, lat, lon, timezone) VALUES (${OTHER}, 1, 2, 'UTC') ON CONFLICT (user_id) DO NOTHING`,
  `INSERT INTO doctor_share_link (user_id, token, expires_at) VALUES (${U}, 'secret-token', now() + interval '7 day')`,
  `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth) VALUES (${U}, 'https://push.example/x', 'k', 'a')`,
  `INSERT INTO community_post (author_id, title, body) VALUES (${U}, '-1 line one', E'multi\\nline, with "quotes" and \\u2028')`,
  `INSERT INTO community_post (author_id, title, body) VALUES (${OTHER}, 'Not mine', 'x')`,
  `INSERT INTO mcp_tool_call_audit (user_id, tool_name, outcome, duration_ms) VALUES (${U}, 'log_attack', 'ok', -12)`,
  `INSERT INTO risk_alert_run (user_id, local_date, type, status, details) VALUES (${U}, '2026-11-20', 'pressure', 'sent', '{"10": 1, "b": [1.50, 2e3, 1e21, 0.0000001], "a": {"2": null, "1": "x"}, "s": "@cmd"}')`,
  `INSERT INTO risk_alert_run (user_id, local_date, type, status, details) VALUES (${U}, '2026-11-21', 'pressure', 'sent', '"=1+1"')`,
];

const scenarios: Scenario[] = [
  {
    name: 'data export',
    sql: extra,
    steps: [
      { name: 'json', path: '/api/user/export', exact: 'text', compareHeaders: ['content-disposition', 'cache-control', 'x-content-type-options'] },
      { name: 'json-explicit', path: '/api/user/export?format=json', exact: 'text' },
      { name: 'csv', path: '/api/user/export?format=csv', exact: 'zip', compareHeaders: ['content-disposition', 'cache-control', 'x-content-type-options'] },
      { name: 'bad-format', path: '/api/user/export?format=xml', compareHeaders: ['cache-control'] },
      { name: 'empty-format', path: '/api/user/export?format=' },
    ],
  },
  {
    name: 'delete account',
    sql: extra,
    steps: [
      { name: 'delete', method: 'DELETE', path: '/api/user/delete-account' },
      { name: 'export-after', path: '/api/user/export', exact: 'text' },
      { name: 'mock-header-ignored', path: '/api/user/export', exact: 'text', headers: { 'x-e2e-mock-user': 'parity_other_user' } },
    ],
  },
];

export default scenarios;
