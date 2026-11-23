// Writes internal/mcp/tools.json: the tools/list result of the Node MCP
// server (names, descriptions, JSON Schemas Zod generated, annotations), so
// the Go server advertises exactly the same tools.
// Run: npx tsx --tsconfig scripts/golden.tsconfig.json scripts/gen-mcp-tools.mts
import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { createMcpHandler } from 'mcp-handler';

import { MCP_INSTRUCTIONS, MCP_SERVER_INFO, registerAllTools } from '@/server/mcp/registry';

const handler = createMcpHandler(server => registerAllTools(server), {
  serverInfo: MCP_SERVER_INFO,
  instructions: MCP_INSTRUCTIONS,
});

const res = await handler(new Request('http://localhost/api/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}));
const text = await res.text();
const data = text.split('\n').find(l => l.startsWith('data: '))!.slice(6);
const { result } = JSON.parse(data);
writeFileSync('internal/mcp/tools.json', `${JSON.stringify({ serverInfo: MCP_SERVER_INFO, instructions: MCP_INSTRUCTIONS, tools: result.tools }, null, 2)}\n`);
process.exit(0);
