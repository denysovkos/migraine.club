import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from '@clerk/mcp-tools/next';

import { MCP_SCOPES } from '@/server/mcp/scopes';

/**
 * Claude requires `resource` to match the MCP server URL exactly as the user
 * types it into the connector, path included — not just the origin.
 * @see https://claude.com/docs/connectors/building/authentication
 */
const MCP_ENDPOINT_PATH = '/api/mcp';

/**
 * The public origin clients reach this server on.
 *
 * `protectedResourceHandlerClerk` derives `resource` from
 * `new URL(req.url).origin`, which behind a proxy is the internal origin — on
 * Render that is `https://localhost:10000`. Clients use `resource` as the RFC
 * 8707 resource indicator when requesting a token, so advertising the internal
 * origin binds tokens to the wrong audience and can make a client reject the
 * connector outright.
 */
function canonicalResourceUrl(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const origin = configured
    ? new URL(configured).origin
    : (() => {
        const forwardedHost = req.headers.get('x-forwarded-host');
        if (forwardedHost) {
          const proto = req.headers.get('x-forwarded-proto') ?? 'https';
          return `${proto}://${forwardedHost}`;
        }
        return new URL(req.url).origin;
      })();

  return `${origin}${MCP_ENDPOINT_PATH}`;
}

/**
 * RFC 9728 protected resource metadata. MCP clients read this to discover that
 * Clerk is the authorization server for /api/mcp.
 */
function handler(req: Request): Response {
  return protectedResourceHandlerClerk({
    scopes_supported: [MCP_SCOPES.READ, MCP_SCOPES.WRITE],
    resource: canonicalResourceUrl(req),
  })(req);
}

const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
