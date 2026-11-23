import type { Scenario, Step } from '../run.mts';

// /api/mcp under E2E_MOCK_AUTH, with the stand-in tokens of
// src/server/mcp/e2eToken.ts. Every response is compared byte for byte.
const U = `'e2e_user_test_001'`;
const OTHER = `'e2e_mcp_other_user'`;
const MED = 'eeeeeeee-0000-4000-8000-000000000001';
const MED2 = 'eeeeeeee-0000-4000-8000-000000000002';
const OTHER_MED = 'eeeeeeee-0000-4000-8000-000000000003';
const PREP = 'eeeeeeee-0000-4000-8000-0000000000a1';
const OTHER_PREP = 'eeeeeeee-0000-4000-8000-0000000000a2';

const TOKEN = 'Bearer e2e-mcp|e2e_user_test_001|migraine:read,migraine:write|parity-client';
const READ_ONLY = 'Bearer e2e-mcp|e2e_user_test_001|migraine:read|parity-client';
const BASE = { 'x-forwarded-host': 'mcp.test', 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' };
// MOH status and the clinician report print local times; insights time themselves.
const MASKS = [/runtimeMs\D*\d+/, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?[+-]\d{2}:\d{2}/, /Generated on \d{4}-\d{2}-\d{2} \d{2}:\d{2}/];

const ENV = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'parity', version: '1' },
};

let n = 0;
function rpc(name: string, body: unknown, headers: Record<string, string> = {}, extra: Partial<Step> = {}): Step {
  return { name, method: 'POST', path: '/api/mcp', body, headers: { ...BASE, authorization: TOKEN, ...headers }, exact: 'text', masks: MASKS, compareHeaders: ['www-authenticate', 'allow', 'cache-control', 'x-accel-buffering'], ...extra };
}
function raw(name: string, rawBody: string, headers: Record<string, string> = {}): Step {
  return { ...rpc(name, undefined, headers), rawBody };
}
function call(name: string, tool: string, args?: unknown, token = TOKEN): Step {
  return rpc(name, { jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name: tool, ...(args === undefined ? {} : { arguments: args }) } }, { authorization: token });
}
function modern(name: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}): Step {
  const mcpName: Record<string, string> = typeof params.name === 'string' ? { 'mcp-name': params.name } : {};
  return rpc(name, { jsonrpc: '2.0', id: ++n, method, params: { ...params, _meta: ENV } }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...mcpName, ...headers });
}

const setup = [
  `DELETE FROM appointment_prep WHERE user_id IN (${U}, ${OTHER})`,
  `DELETE FROM acute_doses WHERE user_id IN (${U}, ${OTHER})`,
  `DELETE FROM medication_intakes WHERE user_id IN (${U}, ${OTHER})`,
  `DELETE FROM episode WHERE user_id IN (${U}, ${OTHER})`,
  `DELETE FROM daily_diary_entry WHERE user_id IN (${U}, ${OTHER})`,
  `DELETE FROM factor_event WHERE user_id IN (${U}, ${OTHER})`,
  `DELETE FROM mcp_tool_call_audit WHERE user_id IN (${U}, ${OTHER})`,
  `INSERT INTO user_medications (id, user_id, custom_name, medication_class, is_acute) VALUES
    ('${MED}', ${U}, 'Sumatriptan', 'triptan', true), ('${MED2}', ${U}, 'Magnesium', 'other', false),
    ('${OTHER_MED}', ${OTHER}, 'OtherOnly', 'triptan', true) ON CONFLICT DO NOTHING`,
  `INSERT INTO episode (id, user_id, attack_type, start_time, end_time, intensity, pain_location, pain_type)
    SELECT 980000 + n, ${U}, CASE WHEN n % 3 = 0 THEN 'headache' ELSE 'migraine' END,
      now() - (n * interval '2 day'), now() - (n * interval '2 day') + interval '3 hour', 1 + n % 5, 'LEFT', 'PRESSURE'
    FROM generate_series(1, 12) n`,
  `INSERT INTO episode (id, user_id, start_time, end_time, intensity, pain_location, pain_type) VALUES
    (980100, ${OTHER}, now() - interval '1 day', now() - interval '20 hour', 4, 'RIGHT', 'STABBING')`,
  // Explicit ids do not move the sequence; the next attack is always 980101.
  `SELECT setval(pg_get_serial_sequence('episode', 'id'), 980100)`,
  `INSERT INTO acute_doses (user_id, medication_id, attack_id, taken_at, dose, unit)
    SELECT ${U}, '${MED}'::uuid, 980000 + n, now() - (n * interval '2 day') + interval '1 hour', '50', 'mg' FROM generate_series(1, 6) n`,
  `INSERT INTO acute_doses (user_id, medication_id, taken_at) VALUES (${OTHER}, '${OTHER_MED}', now() - interval '1 day')`,
  `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type, impact)
    SELECT ${U}, d::date, 'UTC', CASE WHEN extract(day FROM d)::int % 2 = 0 THEN 'migraine_day' ELSE 'headache_free' END, NULL
    FROM generate_series(CURRENT_DATE - 20, CURRENT_DATE - 1, interval '1 day') d`,
  `INSERT INTO appointment_prep (id, user_id, appointment_date, visit_label, top_concerns, doctor_questions, compare_window_days, generated_snapshot) VALUES
    ('${PREP}', ${U}, CURRENT_DATE + 7, 'Neuro follow-up', '["Frequency"]', '["Should I switch?"]', 90, '{}'),
    ('${OTHER_PREP}', ${OTHER}, CURRENT_DATE + 3, 'Other visit', '[]', '[]', 30, '{}')`,
];

const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parity', version: '1' } };

const CORS = ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-max-age', 'cache-control'];
const meta = (name: string, path: string, extra: Partial<Step> = {}): Step => ({ name, path, compareHeaders: CORS, exact: 'text', ...extra });

const scenarios: Scenario[] = [
  {
    name: 'mcp oauth metadata',
    steps: [
      meta('resource-forwarded', '/.well-known/oauth-protected-resource/mcp', { headers: { 'x-forwarded-host': 'mcp.test' } }),
      meta('resource-forwarded-proto', '/.well-known/oauth-protected-resource/mcp', { headers: { 'x-forwarded-host': 'mcp.test', 'x-forwarded-proto': 'http' } }),
      meta('resource-options', '/.well-known/oauth-protected-resource/mcp', { method: 'OPTIONS' }),
      // Clerk's Frontend API is unreachable here, so both fail alike.
      meta('auth-server', '/.well-known/oauth-authorization-server'),
      meta('auth-server-options', '/.well-known/oauth-authorization-server', { method: 'OPTIONS' }),
    ],
  },
  {
    name: 'mcp transport and auth',
    steps: [
      rpc('no-token', { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: '' }),
      rpc('basic', { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Basic abc' }),
      rpc('throws', { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer e2e-mcp-throw' }),
      rpc('bare-bearer', { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer' }),
      rpc('lower-bearer', { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'bearer e2e-mcp|e2e_user_test_001|migraine:read|c' }),
      rpc('forwarded', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'authorization': '', 'x-forwarded-host': '', 'forwarded': 'for=1.2.3.4;host="a.example";proto=http' }),
      rpc('forwarded-proto', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'authorization': '', 'x-forwarded-host': 'x.example, y', 'x-forwarded-proto': 'http, https' }),
      { name: 'get', path: '/api/mcp', headers: { authorization: TOKEN }, exact: 'text', compareHeaders: ['allow'] },
      rpc('init', { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }),
      rpc('init-latest', { jsonrpc: '2.0', id: 'x', method: 'initialize', params: { ...INIT, protocolVersion: '2025-11-25' } }),
      rpc('init-unknown', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { ...INIT, protocolVersion: '1999-01-01' } }),
      rpc('init-bad', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 5, capabilities: { elicitation: 5, roots: { listChanged: 'y' }, sampling: [] }, clientInfo: { name: 1, icons: [{}] } } }),
      rpc('init-no-params', { jsonrpc: '2.0', id: 1, method: 'initialize' }),
      rpc('init-modern-header', { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }, { 'mcp-protocol-version': '2026-07-28' }),
      rpc('init-batch', [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }, { jsonrpc: '2.0', id: 2, method: 'ping' }]),
      rpc('ping', { jsonrpc: '2.0', id: 'p', method: 'ping' }),
      rpc('ping-bad-meta', { jsonrpc: '2.0', id: 1, method: 'ping', params: { _meta: { progressToken: 1.5 } } }),
      rpc('ping-header', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '2025-06-18' }),
      rpc('ping-bad-header', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '2020-01-01' }),
      rpc('list', { jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      rpc('list-bad-cursor', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { cursor: 5 } }),
      rpc('unknown', { jsonrpc: '2.0', id: 3, method: 'foo/bar' }),
      rpc('resources', { jsonrpc: '2.0', id: 3, method: 'resources/list' }),
      rpc('discover-legacy', { jsonrpc: '2.0', id: 3, method: 'server/discover' }),
      rpc('notification', { jsonrpc: '2.0', method: 'notifications/initialized' }),
      rpc('response', { jsonrpc: '2.0', id: 9, result: {} }),
      rpc('batch', [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'nope' }]),
      rpc('batch-dup-ids', [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1, method: 'tools/list' }]),
      rpc('batch-empty', []),
      rpc('batch-invalid', [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { x: 1 }]),
      rpc('batch-modern', [{ jsonrpc: '2.0', id: 1, method: 'ping', params: { _meta: ENV } }]),
      rpc('batch-too-big', Array.from({ length: 101 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }))),
      rpc('invalid-shape', { foo: 1 }),
      rpc('id-float', { jsonrpc: '2.0', id: 1.5, method: 'ping' }),
      rpc('extra-key', { jsonrpc: '2.0', id: 1, method: 'ping', x: 1 }),
      rpc('params-array', { jsonrpc: '2.0', id: 1, method: 'ping', params: [] }),
      raw('bad-json', '{'),
      raw('empty-body', ''),
      raw('bom-body', '﻿{"jsonrpc":"2.0","id":1,"method":"ping"}'),
      rpc('no-accept', { jsonrpc: '2.0', id: 1, method: 'ping' }, { accept: 'application/json' }),
      rpc('text-ct', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'text/plain' }),
      rpc('ct-charset', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'application/json; charset=utf-8' }),
      rpc('ct-upper', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'Application/JSON' }),
      rpc('ct-bad-params', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'application/json; ;' }),
      rpc('ct-comma', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'application/json, text/plain' }),
    ],
  },
  {
    name: 'mcp 2026-07-28 era',
    steps: [
      modern('discover', 'server/discover'),
      modern('list', 'tools/list'),
      modern('ping', 'ping'),
      modern('initialize', 'initialize', INIT),
      modern('unknown', 'foo/bar'),
      modern('resources', 'resources/list'),
      modern('call', 'tools/call', { name: 'list_appointment_preps', arguments: {} }),
      modern('call-bad-args', 'tools/call', { name: 'list_attacks', arguments: { limit: 0 } }),
      modern('call-unknown-tool', 'tools/call', { name: 'nope' }),
      modern('call-missing-name', 'tools/call', {}),
      modern('call-name-mismatch', 'tools/call', { name: 'get_moh_status' }, { 'mcp-name': 'other' }),
      modern('call-name-base64', 'tools/call', { name: 'get_moh_status', arguments: {} }, { 'mcp-name': '=?base64?Z2V0X21vaF9zdGF0dXM=?=' }),
      modern('call-name-bad-base64', 'tools/call', { name: 'get_moh_status' }, { 'mcp-name': '=?base64?***?=' }),
      modern('call-name-missing', 'tools/call', { name: 'get_moh_status' }, { 'mcp-name': '' }),
      modern('no-method-header', 'tools/list', {}, { 'mcp-method': '' }),
      rpc('no-headers', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: ENV } }),
      modern('method-mismatch', 'tools/list', {}, { 'mcp-method': 'tools/call' }),
      modern('version-mismatch', 'tools/list', {}, { 'mcp-protocol-version': '2026-08-01' }),
      rpc('unsupported-revision', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { ...ENV, 'io.modelcontextprotocol/protocolVersion': '2027-01-01' } } }, { 'mcp-protocol-version': '2027-01-01', 'mcp-method': 'tools/list' }),
      rpc('legacy-claim', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { ...ENV, 'io.modelcontextprotocol/protocolVersion': '2025-06-18' } } }, { 'mcp-protocol-version': '2025-06-18', 'mcp-method': 'tools/list' }),
      rpc('envelope-missing-caps', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' }),
      rpc('envelope-bad-info', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { ...ENV, 'io.modelcontextprotocol/clientInfo': { name: 1 } } } }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' }),
      rpc('envelope-version-number', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { ...ENV, 'io.modelcontextprotocol/protocolVersion': 5 } } }),
      rpc('modern-header-no-claim', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: {} } }, { 'mcp-protocol-version': '2026-07-28' }),
      rpc('notification', { jsonrpc: '2.0', method: 'notifications/cancelled', params: { _meta: ENV } }, { 'mcp-protocol-version': '2026-07-28' }),
      rpc('notification-header-only', { jsonrpc: '2.0', method: 'notifications/cancelled' }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'notifications/x' }),
      rpc('notification-bad-claim', { jsonrpc: '2.0', method: 'notifications/cancelled', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': 1 } } }),
      modern('listen-no-filter', 'subscriptions/listen'),
      modern('listen-nothing-honored', 'subscriptions/listen', { notifications: { promptsListChanged: true } }),
    ],
  },
  {
    name: 'mcp tools',
    sql: setup,
    steps: [
      call('context', 'get_user_context'),
      call('attacks', 'list_attacks', {}),
      call('attacks-range', 'list_attacks', { from: '2020-01-01T00:00:00Z', limit: 3 }),
      call('attacks-bad', 'list_attacks', { from: 'yesterday', limit: 500, to: 3 }),
      call('read-only-write', 'log_attack', { intensity: 3 }, READ_ONLY),
      call('log-quick', 'log_attack', { intensity: 3 }),
      call('context-ongoing', 'get_user_context'),
      call('log-while-ongoing', 'log_attack', { intensity: 2, attackType: 'migraine' }),
      call('end', 'update_attack', { attackId: 980101, endNow: true }),
      call('edit-notes', 'update_attack', { attackId: 980005, notes: 'edited', intensity: 2, triggers: ['STRESS'] }),
      call('end-missing', 'update_attack', { attackId: 999999, endNow: true }),
      call('update-other-user', 'update_attack', { attackId: 980100, notes: 'x' }),
      call('update-huge-id', 'update_attack', { attackId: 4000000000, notes: 'x' }),
      call('log-full', 'log_attack', { intensity: 4, startTime: '2026-11-01T08:00:00.000Z', isOngoing: false, painLocation: 'LEFT', symptoms: ['NAUSEA'], notes: 'parity' }),
      call('log-bad-enum', 'log_attack', { intensity: 9, painLocation: 'NOSE', symptoms: ['X'] }),
      call('doses', 'list_medication_doses', { limit: 3 }),
      call('dose-acute', 'log_medication_dose', { userMedicationId: MED, dose: ' 50 ', unit: 'mg', attackId: 980001 }),
      call('dose-intake', 'log_medication_dose', { userMedicationId: MED2 }),
      call('dose-new-name', 'log_medication_dose', { medicationName: '  Brand New Med  ', takenAt: '2026-11-20T10:00:00Z' }),
      call('dose-other-user-med', 'log_medication_dose', { userMedicationId: OTHER_MED }),
      call('dose-none', 'log_medication_dose', {}),
      call('doses-after', 'list_medication_doses', {}),
      call('diary', 'get_diary', { from: '2026-11-01', to: '2026-11-30' }),
      call('diary-bad', 'get_diary', { from: 'x' }),
      call('diary-update', 'update_diary_day', { localDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10), dayType: 'headache_day', impact: null, bedTimeLocal: '23:30' }),
      call('diary-update-old', 'update_diary_day', { localDate: '2020-01-01', dayType: 'headache_day' }),
      call('factor', 'log_factor', { displayName: ' Red wine ', type: 'trigger', occurredAt: '2026-11-20T18:00:00Z' }),
      call('factor-again', 'log_factor', { displayName: 'Red wine', type: 'trigger', occurredAt: '2026-11-21T18:00:00Z' }),
      call('factor-bad', 'log_factor', { displayName: '', type: 'food' }),
      call('insights', 'get_insights', {}),
      call('insights-bad', 'get_insights', { windowDays: 45 }),
      call('moh', 'get_moh_status', {}),
      call('moh-window', 'get_moh_status', { windowDays: 7 }),
      call('report', 'get_clinician_report', {}),
      call('report-range', 'get_clinician_report', { from: '2026-10-01', to: '2026-11-15' }),
      call('report-reversed', 'get_clinician_report', { from: '2026-11-15', to: '2026-10-01' }),
      call('preps', 'list_appointment_preps', { limit: 1 }),
      call('prep', 'get_appointment_prep', { id: PREP }),
      call('prep-other-user', 'get_appointment_prep', { id: OTHER_PREP }),
      call('prep-bad-id', 'get_appointment_prep', { id: 'nope' }),
      call('no-user', 'get_user_context', undefined, 'Bearer e2e-mcp||migraine:read|c'),
      call('attacks-after', 'list_attacks', { limit: 5 }),
    ],
  },
];

export default scenarios;
