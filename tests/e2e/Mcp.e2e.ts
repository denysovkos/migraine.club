import type { APIRequestContext } from '@playwright/test';

import { E2E_USER_ID, query } from './_db';
import { expect, test } from './_fixtures';

// /api/mcp under E2E_MOCK_AUTH accepts the stand-in tokens of
// src/server/mcp/e2eToken.ts instead of Clerk OAuth tokens.
const OTHER_USER_ID = 'e2e_mcp_other_user';
const token = (user: string, scopes = 'migraine:read,migraine:write') => `Bearer e2e-mcp|${user}|${scopes}|e2e-client`;
const HEADERS = { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' };

let nextId = 1;

/** Reads the one JSON-RPC message of an SSE response. */
async function rpc(request: APIRequestContext, method: string, params?: unknown, user = E2E_USER_ID, scopes?: string) {
  const res = await request.post('/api/mcp', {
    headers: { ...HEADERS, authorization: token(user, scopes) },
    data: { jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) },
  });

  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('text/event-stream');

  const text = await res.text();
  const data = text.split('\n').find(line => line.startsWith('data: '))!;
  return JSON.parse(data.slice(6));
}

async function tool(request: APIRequestContext, name: string, args: unknown = {}, user = E2E_USER_ID, scopes?: string) {
  const message = await rpc(request, 'tools/call', { name, arguments: args }, user, scopes);
  const block = message.result.content[0].text as string;
  const json = block.includes('```json\n') ? JSON.parse(block.split('```json\n')[1]!.split('\n```')[0]!) : undefined;
  return { isError: message.result.isError === true, summary: block.split('\n')[0]!, data: json };
}

test.describe('MCP connector', () => {
  test.afterEach(async () => {
    await query('DELETE FROM episode WHERE user_id = $1', [OTHER_USER_ID]);
    await query('DELETE FROM mcp_tool_call_audit WHERE user_id = $1', [OTHER_USER_ID]);
  });

  test('a client initializes, lists tools and logs and ends an attack', async ({ page }) => {
    const init = await rpc(page.request, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });

    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.serverInfo).toEqual({ name: 'migraine-club', version: '1.0.0' });

    const list = await rpc(page.request, 'tools/list');

    expect(list.result.tools).toHaveLength(14);

    const context = await tool(page.request, 'get_user_context');

    expect(context.data.healthDataConsent).toBe(true);
    expect(context.data.ongoingAttack).toBeNull();

    const logged = await tool(page.request, 'log_attack', { intensity: 3 });

    expect(logged.isError).toBe(false);

    const attackId = logged.data.id as number;
    const ended = await tool(page.request, 'update_attack', { attackId, endNow: true });

    expect(ended.summary).toMatch(new RegExp(`^Attack ${attackId} updated; ended `));

    const rows = await query<{ user_id: string; is_ongoing: boolean }>('SELECT user_id, is_ongoing FROM episode WHERE id = $1', [attackId]);

    expect(rows).toEqual([{ user_id: E2E_USER_ID, is_ongoing: false }]);

    const audit = await query<{ tool_name: string; outcome: string; client_id: string }>(
      'SELECT tool_name, outcome, client_id FROM mcp_tool_call_audit WHERE user_id = $1 ORDER BY created_at',
      [E2E_USER_ID],
    );

    expect(audit.map(a => `${a.tool_name}:${a.outcome}:${a.client_id}`)).toEqual([
      'get_user_context:ok:e2e-client',
      'log_attack:ok:e2e-client',
      'update_attack:ok:e2e-client',
    ]);
  });

  test('rejects missing tokens, bad arguments and writes without the write scope', async ({ page }) => {
    const anonymous = await page.request.post('/api/mcp', { headers: HEADERS, data: { jsonrpc: '2.0', id: 1, method: 'ping' } });

    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()['www-authenticate']).toContain('error_description="No authorization provided"');

    const invalid = await tool(page.request, 'list_attacks', { limit: 0 });

    expect(invalid.isError).toBe(true);
    expect(invalid.summary).toBe('Input validation error: Invalid arguments for tool list_attacks: limit: Too small: expected number to be >=1');

    const readOnly = await tool(page.request, 'log_attack', { intensity: 2 }, E2E_USER_ID, 'migraine:read');

    expect(readOnly.isError).toBe(true);
    expect(readOnly.data.code).toBe('INSUFFICIENT_SCOPE');
    expect(await query('SELECT id FROM episode WHERE user_id = $1 AND is_ongoing', [E2E_USER_ID])).toHaveLength(0);

    const unknown = await rpc(page.request, 'tools/call', { name: 'delete_everything' });

    expect(unknown.error).toEqual({ code: -32602, message: 'Tool delete_everything not found' });
  });

  test('one user never sees or changes another user\'s attacks', async ({ page }) => {
    const [other] = await query<{ id: number }>(
      `INSERT INTO episode (user_id, start_time, end_time, intensity, pain_location, pain_type)
       VALUES ($1, now() - interval '1 day', now() - interval '20 hour', 4, 'LEFT', 'PRESSURE') RETURNING id`,
      [OTHER_USER_ID],
    );

    const mine = await tool(page.request, 'list_attacks', { limit: 200 });

    expect(mine.data.attacks.map((a: { id: number }) => a.id)).not.toContain(other!.id);

    const update = await tool(page.request, 'update_attack', { attackId: other!.id, notes: 'hijack' });

    expect(update.isError).toBe(true);
    expect(update.data.code).toBe('NOT_FOUND');

    const theirs = await tool(page.request, 'list_attacks', {}, OTHER_USER_ID);

    expect(theirs.data.attacks.map((a: { id: number }) => a.id)).toEqual([other!.id]);

    const [row] = await query<{ notes: string | null }>('SELECT notes FROM episode WHERE id = $1', [other!.id]);

    expect(row!.notes).toBeNull();
  });

  test('serves the OAuth protected resource metadata', async ({ page }) => {
    const res = await page.request.get('/.well-known/oauth-protected-resource/mcp', { headers: { 'x-forwarded-host': 'mcp.example.test', 'x-forwarded-proto': 'https' } });

    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBe('*');

    const body = await res.json();

    expect(body.resource).toBe('https://mcp.example.test/api/mcp');
    expect(body.scopes_supported).toEqual(['migraine:read', 'migraine:write']);
  });
});
