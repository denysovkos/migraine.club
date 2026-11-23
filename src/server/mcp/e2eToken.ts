/**
 * Stand-in OAuth verification for /api/mcp under E2E_MOCK_AUTH, so e2e and
 * parity tests can call the MCP endpoint without Clerk. Tokens look like
 * `e2e-mcp|<userId>|<scope scope>|<clientId>`; `e2e-mcp-throw` makes the
 * verifier throw; anything else counts as no authorization. NEVER enable mock
 * auth in production.
 */
export type E2EMcpAuthInfo = {
  token: string;
  clientId: string;
  scopes: string[];
  extra: { userId: string | undefined };
};

export async function verifyE2EMcpToken(token: string | undefined): Promise<E2EMcpAuthInfo | undefined> {
  if (token === 'e2e-mcp-throw') {
    throw new Error('verifier failed');
  }
  if (!token?.startsWith('e2e-mcp|')) {
    return undefined;
  }
  const [, userId, scopes, clientId] = token.split('|');
  return { token, clientId: clientId ?? 'e2e-client', scopes: scopes ? scopes.split(' ') : [], extra: { userId } };
}
