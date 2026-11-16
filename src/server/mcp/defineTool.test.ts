import { createMcpHandler } from 'mcp-handler';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { isToolExtra, registerTool, resolveAuthInfo } from '@/server/mcp/defineTool';
import { MCP_SCOPES } from '@/server/mcp/scopes';

vi.mock('@/server/mcp/audit', () => ({ recordToolCall: vi.fn(async () => undefined) }));

const AUTH = {
  token: 'tok',
  clientId: 'client_abc',
  scopes: [MCP_SCOPES.READ, MCP_SCOPES.WRITE],
  extra: { userId: 'user_123' },
};

/** Drive a real tools/call through mcp-handler, the way a client would. */
async function callTool(args: {
  inputSchema?: Record<string, any>;
  scope?: typeof MCP_SCOPES.READ | typeof MCP_SCOPES.WRITE;
  grantedScopes?: string[];
  toolArgs?: Record<string, unknown>;
}) {
  const seen: { userId?: string; clientId?: string; args?: unknown } = {};

  const handler = createMcpHandler((server) => {
    registerTool(server as any, {
      name: 'probe',
      description: 'probe',
      scope: args.scope ?? MCP_SCOPES.READ,
      ...(args.inputSchema ? { inputSchema: args.inputSchema } : {}),
      handler: async (toolArgs, ctx) => {
        seen.userId = ctx.userId;
        seen.clientId = ctx.clientId;
        seen.args = toolArgs;
        return { summary: 'ok', data: { fine: true } };
      },
    });
  });

  const request = (body: unknown) => {
    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    });
    (req as any).auth = { ...AUTH, scopes: args.grantedScopes ?? AUTH.scopes };
    return req;
  };

  await handler(request({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    },
  }));

  const res = await handler(request({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'probe', arguments: args.toolArgs ?? {} },
  }));

  const text = await res.text();
  return { seen, body: text };
}

describe('resolveAuthInfo', () => {
  // mcp-handler v2 runs on @modelcontextprotocol/server, which nests authInfo
  // under `extra.http`. Reading `extra.authInfo` alone silently yields
  // undefined, which surfaces to the user as "Not authenticated".
  it('reads authInfo from extra.http (mcp-handler v2 shape)', () => {
    expect(resolveAuthInfo({ http: { authInfo: AUTH } })).toBe(AUTH);
  });

  it('still reads the legacy extra.authInfo shape', () => {
    expect(resolveAuthInfo({ authInfo: AUTH })).toBe(AUTH);
  });

  it('returns undefined when no token is present', () => {
    expect(resolveAuthInfo({ sessionId: 'x' })).toBeUndefined();
    expect(resolveAuthInfo(undefined)).toBeUndefined();
  });
});

describe('isToolExtra', () => {
  it('recognises the SDK extra object', () => {
    expect(isToolExtra({ sessionId: 'a', mcpReq: {}, http: {} })).toBe(true);
  });

  it('does not mistake parsed tool arguments for the extra', () => {
    expect(isToolExtra({ from: '2026-01-01', limit: 10 })).toBe(false);
    expect(isToolExtra({})).toBe(false);
    expect(isToolExtra(null)).toBe(false);
  });
});

describe('registerTool wiring', () => {
  it('passes the authenticated userId through to a tool with an input schema', async () => {
    const { seen } = await callTool({
      inputSchema: { foo: z.string().optional() },
      toolArgs: { foo: 'bar' },
    });

    expect(seen.userId).toBe('user_123');
    expect(seen.clientId).toBe('client_abc');
    expect(seen.args).toMatchObject({ foo: 'bar' });
  });

  it('passes the authenticated userId through to a tool with no input schema', async () => {
    const { seen } = await callTool({});

    expect(seen.userId).toBe('user_123');
    expect(seen.clientId).toBe('client_abc');
  });

  it('refuses a write tool when the token lacks the write scope', async () => {
    const { seen, body } = await callTool({
      scope: MCP_SCOPES.WRITE,
      grantedScopes: [MCP_SCOPES.READ],
    });

    expect(seen.userId).toBeUndefined();
    expect(body).toContain('INSUFFICIENT_SCOPE');
  });
});
