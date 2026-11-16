import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { mcpToolCallAuditSchema } from '@/models/Schema';

export type McpAuditEntry = {
  userId: string;
  toolName: string;
  clientId?: string | null;
  outcome: 'ok' | 'error';
  errorCode?: string | null;
  durationMs?: number;
};

/**
 * Record a tool call. Best-effort: an audit failure must never fail the tool,
 * so this swallows its own errors after logging them.
 */
export async function recordToolCall(entry: McpAuditEntry): Promise<void> {
  try {
    await db.insert(mcpToolCallAuditSchema).values({
      userId: entry.userId,
      toolName: entry.toolName,
      clientId: entry.clientId ?? null,
      outcome: entry.outcome,
      errorCode: entry.errorCode ?? null,
      durationMs: entry.durationMs ?? null,
    });
  } catch (error) {
    logger.warn({ error, toolName: entry.toolName }, 'Failed to write MCP tool call audit row');
  }
}
