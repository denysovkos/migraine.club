// Serves the Node MCP endpoint (mcp-handler + src/server/mcp) on
// MCP_PARITY_PORT with a stand-in token check, so tests/parity/scenarios/mcp.mts
// can compare tool calls with the Go server. Tokens look like
// `parity|<userId>|<scope scope>|<clientId>`; "parity-throw" makes the
// verifier throw; anything else is "no authorization".
// Run: npx tsx --tsconfig scripts/golden.tsconfig.json scripts/mcp-parity-server.mts
import { Buffer } from 'node:buffer';
import http from 'node:http';
import process from 'node:process';

import { createMcpHandler, withMcpAuth } from 'mcp-handler';

import { MCP_INSTRUCTIONS, MCP_SERVER_INFO, registerAllTools } from '@/server/mcp/registry';

const handler = createMcpHandler(server => registerAllTools(server), {
  serverInfo: MCP_SERVER_INFO,
  instructions: MCP_INSTRUCTIONS,
});

const auth = withMcpAuth(handler, async (_req, token) => {
  if (token === 'parity-throw') {
    throw new Error('verifier failed');
  }
  if (!token?.startsWith('parity|')) {
    return undefined;
  }
  const [, userId, scopes, clientId] = token.split('|');
  return { token, clientId: clientId ?? 'parity-client', scopes: scopes ? scopes.split(' ') : [], extra: { userId } };
}, { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp' });

const port = Number(process.env.MCP_PARITY_PORT ?? 3097);
http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
  }
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') {
      headers.set(k, v);
    }
  }
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });
  const response = await auth(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port);
