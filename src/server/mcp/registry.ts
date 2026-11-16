import type { McpServer } from '@modelcontextprotocol/server';

import { registerAnalysisTools } from '@/server/mcp/tools/analysis';
import { registerAttackTools } from '@/server/mcp/tools/attacks';
import { registerContextTools } from '@/server/mcp/tools/context';
import { registerDiaryTools } from '@/server/mcp/tools/diary';
import { registerMedicationTools } from '@/server/mcp/tools/medications';

/** The single place every MCP tool is wired up. */
export function registerAllTools(server: McpServer): void {
  registerContextTools(server);
  registerAttackTools(server);
  registerMedicationTools(server);
  registerDiaryTools(server);
  registerAnalysisTools(server);
}

export const MCP_SERVER_INFO = {
  name: 'migraine-club',
  version: '1.0.0',
} as const;

export const MCP_INSTRUCTIONS = [
  'This server exposes one migraine.club user\'s own health records.',
  'Call get_user_context first: it gives the timezone needed to resolve relative times like',
  '"this morning", tells you whether an attack is already ongoing, and reports whether the user',
  'has granted health-data consent (writes fail without it).',
  'When logging, record only what the user actually said. Do not infer pain location, triggers or',
  'severity they did not state — omitted fields can be filled in later in the app.',
  'Nothing here can delete a record. Corrections are made with update_attack or update_diary_day.',
  'For clinical questions about medication overuse or trigger patterns, use get_moh_status and',
  'get_insights rather than deriving conclusions from raw records yourself.',
].join(' ');
