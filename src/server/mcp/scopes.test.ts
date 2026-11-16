import { describe, expect, it } from 'vitest';

import { MCP_SCOPES, McpScopeError, requireScope } from '@/server/mcp/scopes';

describe('requireScope', () => {
  it('passes when the granted scopes include the required one', () => {
    expect(() => requireScope([MCP_SCOPES.READ, MCP_SCOPES.WRITE], MCP_SCOPES.WRITE)).not.toThrow();
  });

  it('rejects a read-only connection attempting a write', () => {
    const err = (() => {
      try {
        requireScope([MCP_SCOPES.READ], MCP_SCOPES.WRITE);
        return null;
      } catch (e) {
        return e as McpScopeError;
      }
    })();

    expect(err).toBeInstanceOf(McpScopeError);
    expect(err!.code).toBe('INSUFFICIENT_SCOPE');
    expect(err!.required).toBe(MCP_SCOPES.WRITE);
  });

  it('rejects when no scopes were granted at all', () => {
    expect(() => requireScope(undefined, MCP_SCOPES.READ)).toThrow(McpScopeError);
    expect(() => requireScope([], MCP_SCOPES.READ)).toThrow(McpScopeError);
  });
});
