export const MCP_SCOPES = {
  READ: 'migraine:read',
  WRITE: 'migraine:write',
} as const;

export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];

export class McpScopeError extends Error {
  code = 'INSUFFICIENT_SCOPE' as const;
  required: McpScope;
  constructor(required: McpScope) {
    super(`This action requires the "${required}" scope, which this connection was not granted.`);
    this.required = required;
  }
}

/**
 * Throw unless the token carries the scope a tool needs.
 *
 * Clerk applies the instance's default scopes when a client omits `scope` on
 * connect (Claude does). `migraine:write` is deliberately not a default, so a
 * read-only connection fails here rather than silently writing.
 */
export function requireScope(granted: string[] | undefined, required: McpScope): void {
  if (!granted?.includes(required)) {
    throw new McpScopeError(required);
  }
}
