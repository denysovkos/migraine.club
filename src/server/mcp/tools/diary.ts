import type { McpServer } from '@modelcontextprotocol/server';
import type { LocalDateString } from '@/services/localDate';

import { z } from 'zod';
import { FactorType } from '@/models/Schema';
import { registerTool } from '@/server/mcp/defineTool';
import { MCP_SCOPES } from '@/server/mcp/scopes';
import { dailyDiaryService } from '@/services/DailyDiaryService';
import { factorService } from '@/services/factors/FactorService';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export function registerDiaryTools(server: McpServer): void {
  registerTool(server, {
    name: 'get_diary',
    description:
      'Read the user\'s daily diary across a range of local dates: whether each day was '
      + 'headache-free, a headache day or a migraine day, plus impact, sleep times and notes. '
      + 'Dates are the user\'s local dates, not UTC.',
    scope: MCP_SCOPES.READ,
    readOnly: true,
    inputSchema: {
      from: Ymd.describe('First local date, YYYY-MM-DD.'),
      to: Ymd.describe('Last local date, inclusive, YYYY-MM-DD.'),
    },
    handler: async (args, ctx) => {
      const result = await dailyDiaryService.getDailyDiaryRange({
        userId: ctx.userId,
        fromLocalDate: args.from as LocalDateString,
        toLocalDate: args.to as LocalDateString,
      });

      return {
        summary: `Diary from ${args.from} to ${args.to}.`,
        data: result,
      };
    },
  });

  registerTool(server, {
    name: 'update_diary_day',
    description:
      'Set or update the diary entry for one local date — day type, impact, sleep times, notes. '
      + 'Only days within the last 30 days can be edited; older days fail with NOT_EDITABLE. '
      + 'Pass only the fields the user actually mentioned.',
    scope: MCP_SCOPES.WRITE,
    inputSchema: {
      localDate: Ymd.describe('The local date to update, YYYY-MM-DD.'),
      dayType: z.enum(['headache_free', 'headache_day', 'migraine_day']).optional(),
      impact: z.number().int().min(0).max(4).nullable().optional().describe('How much the day was affected, 0-4.'),
      notes: z.string().max(2000).nullable().optional(),
      bedTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional().describe('HH:MM local.'),
      wakeTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional().describe('HH:MM local.'),
    },
    handler: async (args, ctx) => {
      const { localDate, ...patch } = args;

      const saved = await dailyDiaryService.upsertDailyDiaryEntry({
        userId: ctx.userId,
        localDate: localDate as LocalDateString,
        patch: patch as any,
      });

      return {
        summary: `Diary entry for ${localDate} saved.`,
        data: saved,
      };
    },
  });

  registerTool(server, {
    name: 'log_factor',
    description:
      'Log a trigger, protector or symptom the user experienced — for example "red wine" as a '
      + 'trigger or "dark room" as a protector. Reuses an existing factor with the same name '
      + 'and type when the user already has one.',
    scope: MCP_SCOPES.WRITE,
    inputSchema: {
      displayName: z.string().trim().min(1).max(80).describe('What the factor is, as the user described it.'),
      type: z.enum([FactorType.TRIGGER, FactorType.PROTECTOR, FactorType.SYMPTOM]),
      occurredAt: z.string().datetime().optional().describe('When it happened, ISO 8601. Defaults to now.'),
    },
    handler: async (args, ctx) => {
      const result = await factorService.log(ctx.userId, args);

      return {
        summary: `Logged ${args.type} "${args.displayName}".`,
        data: { ...result, occurredAt: result.occurredAt.toISOString() },
      };
    },
  });
}
