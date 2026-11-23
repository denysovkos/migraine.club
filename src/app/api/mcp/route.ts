import { verifyClerkToken } from '@clerk/mcp-tools/next';
import { auth } from '@clerk/nextjs/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';

import { isE2EMockAuth } from '@/libs/E2EAuth';
import { verifyE2EMcpToken } from '@/server/mcp/e2eToken';
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO, registerAllTools } from '@/server/mcp/registry';

const handler = createMcpHandler(
  (server) => {
    registerAllTools(server);
  },
  {
    serverInfo: MCP_SERVER_INFO,
    instructions: MCP_INSTRUCTIONS,
  },
);

/**
 * Clerk is the OAuth 2.1 authorization server for this endpoint. We verify the
 * bearer token it issued and never store tokens ourselves — the MCP client
 * holds the access and refresh tokens.
 *
 * Note: `src/proxy.ts` deliberately skips Clerk session protection for this
 * path so the bearer token reaches this handler instead of being rejected as a
 * missing session.
 */
const authHandler = withMcpAuth(
  handler,
  async (_req, token) => {
    if (isE2EMockAuth()) {
      return verifyE2EMcpToken(token);
    }
    const clerkAuth = await auth({ acceptsToken: 'oauth_token' });
    return verifyClerkToken(clerkAuth, token);
  },
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
  },
);

export { authHandler as GET, authHandler as POST };

export const dynamic = 'force-dynamic';
