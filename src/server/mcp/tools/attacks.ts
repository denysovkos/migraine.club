import type { McpServer } from '@modelcontextprotocol/server';

import { z } from 'zod';
import { registerTool } from '@/server/mcp/defineTool';
import { MCP_SCOPES } from '@/server/mcp/scopes';
import { episodeService, toEpisodeDTO } from '@/services/episodes/EpisodeService';
import { PainLocation, PainType, Protector, Symptom, Trigger } from '@/types/Episode';

const MAX_LIMIT = 200;

export function registerAttackTools(server: McpServer): void {
  registerTool(server, {
    name: 'list_attacks',
    description:
      'List the user\'s migraine and headache attacks in a date range, newest first. '
      + 'Use this to answer questions about frequency, severity trends, or what happened on a given day.',
    scope: MCP_SCOPES.READ,
    readOnly: true,
    inputSchema: {
      from: z.string().datetime().optional().describe('Start of range, ISO 8601. Defaults to unbounded.'),
      to: z.string().datetime().optional().describe('End of range, ISO 8601. Defaults to unbounded.'),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Max attacks to return (default 50, max ${MAX_LIMIT}).`),
    },
    handler: async (args, ctx) => {
      const limit = Math.min(args.limit ?? 50, MAX_LIMIT);
      const result = await episodeService.list(ctx.userId, {
        from: args.from ?? null,
        to: args.to ?? null,
        limit,
        page: 1,
      });

      return {
        summary: `${result.episodes.length} attack(s) returned of ${result.pagination.total} in range.`,
        data: {
          returned: result.episodes.length,
          total: result.pagination.total,
          truncated: result.pagination.total > result.episodes.length,
          attacks: result.episodes,
        },
      };
    },
  });

  registerTool(server, {
    name: 'log_attack',
    description:
      'Log a new migraine or headache attack for the user. Only intensity is required; '
      + 'omit anything the user did not actually say rather than guessing. '
      + 'If an attack is already ongoing this fails with ONGOING_EXISTS, except that starting a '
      + 'migraine while a headache is ongoing ends the headache automatically. '
      + 'Call get_user_context first so startTime is interpreted in the user\'s timezone.',
    scope: MCP_SCOPES.WRITE,
    inputSchema: {
      intensity: z.number().int().min(1).max(5).describe('Pain intensity on a 1-5 scale.'),
      attackType: z.enum(['migraine', 'headache']).optional().describe('Defaults to migraine.'),
      startTime: z.string().datetime().optional().describe('When it started, ISO 8601. Defaults to now.'),
      onsetAt: z.string().datetime().optional().describe('First symptom onset, ISO 8601. Defaults to startTime.'),
      isOngoing: z.boolean().optional().describe('Whether the attack is still happening. Defaults to true.'),
      painLocation: z.nativeEnum(PainLocation).optional(),
      painType: z.nativeEnum(PainType).optional(),
      symptoms: z.array(z.nativeEnum(Symptom)).optional(),
      triggers: z.array(z.nativeEnum(Trigger)).optional(),
      protectors: z.array(z.nativeEnum(Protector)).optional(),
      notes: z.string().max(2000).optional(),
    },
    handler: async (args, ctx) => {
      const hasDetail
        = args.painLocation !== undefined
          || args.painType !== undefined
          || args.symptoms !== undefined
          || args.triggers !== undefined
          || args.protectors !== undefined
          || args.notes !== undefined;

      // Without descriptive detail this is the quick-add shape, which fills
      // placeholder pain fields the user can enrich later in the app.
      const body = hasDetail
        ? {
            intensity: args.intensity,
            attackType: args.attackType,
            startTime: args.startTime,
            onsetAt: args.onsetAt,
            isOngoing: args.isOngoing ?? true,
            painLocation: args.painLocation ?? PainLocation.OTHER,
            painType: args.painType ?? PainType.OTHER,
            symptoms: args.symptoms ?? [],
            triggers: args.triggers ?? [],
            protectors: args.protectors ?? [],
            notes: args.notes,
          }
        : {
            mode: 'quick' as const,
            intensity: args.intensity,
            attackType: args.attackType,
            startTime: args.startTime,
            onsetAt: args.onsetAt,
            isOngoing: args.isOngoing ?? true,
          };

      const episode = await episodeService.create(ctx.userId, body);

      return {
        summary: `Logged ${episode.attackType} at intensity ${episode.intensity}/5 (attack id ${episode.id}).`,
        data: episode,
      };
    },
  });

  registerTool(server, {
    name: 'update_attack',
    description:
      'Update an existing attack, or end an ongoing one by passing endNow. '
      + 'Timeline and type edits are only allowed within the last 30 days; descriptive fields can be '
      + 'edited any time. Ending an ongoing attack "now" is always allowed. '
      + 'This never deletes anything.',
    scope: MCP_SCOPES.WRITE,
    inputSchema: {
      attackId: z.number().int().positive().describe('The attack to update.'),
      endNow: z.boolean().optional().describe('End the ongoing attack as of now. Takes precedence over endTime.'),
      endTime: z.string().datetime().optional(),
      startTime: z.string().datetime().optional(),
      onsetAt: z.string().datetime().optional(),
      isOngoing: z.boolean().optional(),
      intensity: z.number().int().min(1).max(5).optional(),
      attackType: z.enum(['migraine', 'headache']).optional(),
      painLocation: z.nativeEnum(PainLocation).optional(),
      painType: z.nativeEnum(PainType).optional(),
      symptoms: z.array(z.nativeEnum(Symptom)).optional(),
      triggers: z.array(z.nativeEnum(Trigger)).optional(),
      protectors: z.array(z.nativeEnum(Protector)).optional(),
      notes: z.string().max(2000).optional(),
    },
    handler: async (args, ctx) => {
      const { attackId, ...patch } = args;
      const updated = await episodeService.update(ctx.userId, attackId, patch);

      return {
        summary: updated.isOngoing
          ? `Attack ${attackId} updated; still ongoing.`
          : `Attack ${attackId} updated; ended ${updated.endTime?.toISOString() ?? 'unknown'}.`,
        data: toEpisodeDTO(updated),
      };
    },
  });
}
