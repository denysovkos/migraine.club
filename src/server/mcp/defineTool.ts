import type { McpServer } from '@modelcontextprotocol/server';
import type { ZodRawShape } from 'zod';
import type { McpScope } from '@/server/mcp/scopes';

import { z } from 'zod';
import { logger } from '@/libs/Logger';
import { recordToolCall } from '@/server/mcp/audit';
import { McpScopeError, requireScope } from '@/server/mcp/scopes';
import { AcuteDoseError } from '@/services/acuteMedications/AcuteDoseService';
import { DailyDiaryError } from '@/services/DailyDiaryService';
import { EpisodeError } from '@/services/episodes/EpisodeService';
import { FactorError } from '@/services/factors/FactorService';
import { MedicationResolutionError } from '@/services/medications/resolveUserMedication';

export type ToolContext = {
  userId: string;
  clientId: string;
  scopes: string[];
};

export type ToolResult = {
  /** One line the model can quote without re-serializing the payload. */
  summary: string;
  data?: unknown;
};

export type ToolDefinition<S extends ZodRawShape> = {
  name: string;
  description: string;
  inputSchema?: S;
  scope: McpScope;
  /** Advertised to clients so they can label destructive/idempotent operations. */
  readOnly?: boolean;
  handler: (args: any, ctx: ToolContext) => Promise<ToolResult>;
};

/**
 * Translate a service-layer error into a code the model can act on.
 * Anything unrecognised becomes INTERNAL_ERROR with no detail leaked.
 */
function toErrorPayload(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof McpScopeError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof EpisodeError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof AcuteDoseError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof FactorError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof MedicationResolutionError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof DailyDiaryError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof z.ZodError) {
    return { code: 'VALIDATION_ERROR', message: 'Invalid arguments', details: error.issues };
  }
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong handling this request.' };
}

/**
 * Locate the verified token on the tool callback's `extra` argument.
 *
 * `mcp-handler` v2 runs on `@modelcontextprotocol/server`, which nests it at
 * `extra.http.authInfo` — `extra` itself only carries `sessionId`, `mcpReq` and
 * `http`. The older `@modelcontextprotocol/sdk` put it at `extra.authInfo`, and
 * Clerk's documented example still reads it from there, so check both rather
 * than depend on which package resolves.
 */
export function resolveAuthInfo(extra: any): any | undefined {
  return extra?.http?.authInfo ?? extra?.authInfo;
}

/** Distinguish the SDK's per-request `extra` from a tool's parsed arguments. */
export function isToolExtra(value: any): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'http' in value || 'mcpReq' in value || 'sessionId' in value || 'authInfo' in value;
}

function textBlock(summary: string, payload: unknown) {
  const body = payload === undefined
    ? summary
    : `${summary}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  return { content: [{ type: 'text' as const, text: body }] };
}

/**
 * Register a tool with the shared cross-cutting behaviour: scope enforcement,
 * audit, error mapping, and output shape. Tools themselves stay pure
 * translation — they never touch the database or the auth layer directly.
 */
export function registerTool<S extends ZodRawShape>(
  server: McpServer,
  def: ToolDefinition<S>,
): void {
  server.registerTool(
    def.name,
    {
      description: def.description,
      ...(def.inputSchema ? { inputSchema: def.inputSchema } : {}),
      annotations: {
        readOnlyHint: def.readOnly ?? false,
        destructiveHint: false,
      },
    } as any,
    (async (argsOrExtra: any, maybeExtra: any) => {
      // With an input schema the SDK passes (args, extra); without one, just
      // (extra). Detect which argument is the extra rather than trusting that,
      // so a change in either package's arity cannot silently drop the token.
      const extra = isToolExtra(maybeExtra)
        ? maybeExtra
        : isToolExtra(argsOrExtra) ? argsOrExtra : maybeExtra;
      const args = extra === argsOrExtra ? {} : (argsOrExtra ?? {});

      const authInfo = resolveAuthInfo(extra);
      const userId = authInfo?.extra?.userId as string | undefined;
      const clientId = (authInfo?.clientId as string | undefined) ?? 'unknown';
      const scopes = (authInfo?.scopes as string[] | undefined) ?? [];

      const startedAt = Date.now();

      if (!userId) {
        // withMcpAuth should have rejected this already; treat as unauthenticated.
        return {
          isError: true,
          ...textBlock('Not authenticated.', { code: 'UNAUTHENTICATED' }),
        };
      }

      try {
        requireScope(scopes, def.scope);

        const result = await def.handler(args, { userId, clientId, scopes });

        void recordToolCall({
          userId,
          toolName: def.name,
          clientId,
          outcome: 'ok',
          durationMs: Date.now() - startedAt,
        });

        return textBlock(result.summary, result.data);
      } catch (error) {
        const payload = toErrorPayload(error);

        if (payload.code === 'INTERNAL_ERROR') {
          logger.error({ error, tool: def.name, userId }, 'MCP tool failed');
        }

        void recordToolCall({
          userId,
          toolName: def.name,
          clientId,
          outcome: 'error',
          errorCode: payload.code,
          durationMs: Date.now() - startedAt,
        });

        return {
          isError: true,
          ...textBlock(payload.message, payload),
        };
      }
    }) as any,
  );
}
