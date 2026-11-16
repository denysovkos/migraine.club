import type { McpServer } from '@modelcontextprotocol/server';

import { z } from 'zod';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { registerTool } from '@/server/mcp/defineTool';
import { MCP_SCOPES } from '@/server/mcp/scopes';
import { getMOHStatus } from '@/services/acuteMedications/moh';
import { appointmentPrepService } from '@/services/appointmentPrep/AppointmentPrepService';
import { insightsCacheStore } from '@/services/insights/InsightsCacheStore';
import { insightsService } from '@/services/insights/InsightsService';
import { clinicianReportConfigSchema } from '@/services/reports/clinician/config';
import { getClinicianReportModel } from '@/services/reports/clinician/model';
import { renderClinicianReportHtml } from '@/services/reports/clinician/renderHtml';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** Strip tags and collapse whitespace so the model gets prose, not markup. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function registerAnalysisTools(server: McpServer): void {
  registerTool(server, {
    name: 'get_insights',
    description:
      'Get the computed insights for the user: statistically tested associations between '
      + 'candidate triggers and their attacks over a rolling window. Use this to answer '
      + '"why am I getting more attacks?" rather than inferring patterns yourself from raw records.',
    scope: MCP_SCOPES.READ,
    readOnly: true,
    inputSchema: {
      windowDays: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)])
        .optional()
        .describe('Analysis window in days. Defaults to 90.'),
    },
    handler: async (args, ctx) => {
      if (!Env.ENABLE_F39_INSIGHTS) {
        return {
          summary: 'Insights are not enabled for this deployment.',
          data: { state: 'disabled' },
        };
      }

      if (!(await insightsService.hasHealthDataConsent(ctx.userId))) {
        return {
          summary: 'Health data consent is required before insights can be computed.',
          data: { state: 'consent_required' },
        };
      }

      const windowDays = args.windowDays ?? 90;
      const methodVersion = insightsService.methodVersion;
      const now = new Date();

      const cached = await insightsCacheStore.getLatest({ userId: ctx.userId, windowDays, methodVersion });
      const staleMs = 24 * 60 * 60 * 1000;
      const isStale = !cached
        || cached.stale
        || now.getTime() - cached.computedAt.getTime() > staleMs;

      if (isStale) {
        try {
          const result = await insightsService.computeAndStoreForUser({
            userId: ctx.userId,
            windowDays,
            nowUtc: now,
          });
          return {
            summary: `Insights over the last ${windowDays} days.`,
            data: {
              state: 'ready',
              windowDays,
              methodVersion,
              payload: result.payload,
              status: result.status,
            },
          };
        } catch (error) {
          logger.error({ error, userId: ctx.userId, windowDays }, 'MCP insights recompute failed');
          if (!cached) {
            throw error;
          }
        }
      }

      return {
        summary: `Insights over the last ${windowDays} days.`,
        data: {
          state: 'ready',
          windowDays,
          methodVersion,
          payload: cached!.payloadJson,
          computedAt: cached!.computedAt.toISOString(),
          status: isStale ? 'stale' : 'ready',
        },
      };
    },
  });

  registerTool(server, {
    name: 'get_moh_status',
    description:
      'Get the user\'s medication-overuse headache risk status: how many days in the rolling '
      + 'window they have used each class of acute medication, against the clinical threshold. '
      + 'Report what this returns; do not compute overuse risk yourself.',
    scope: MCP_SCOPES.READ,
    readOnly: true,
    inputSchema: {
      windowDays: z.number().int().min(1).max(60).optional().describe('Rolling window in days. Defaults to 30.'),
    },
    handler: async (args, ctx) => {
      const result = await getMOHStatus(ctx.userId, new Date(), args.windowDays ?? 30);

      return {
        summary: `Medication-overuse status: ${result.status}.`,
        data: result,
      };
    },
  });

  registerTool(server, {
    name: 'get_clinician_report',
    description:
      'Generate the clinician-facing summary report for a date range, as plain text. '
      + 'This is the same report the user can export for a doctor\'s appointment: attack '
      + 'frequency, medication use, diary summary and insights.',
    scope: MCP_SCOPES.READ,
    readOnly: true,
    inputSchema: {
      from: Ymd.optional().describe('Start local date, YYYY-MM-DD. Omit to use the preset range.'),
      to: Ymd.optional().describe('End local date, YYYY-MM-DD. Omit to use the preset range.'),
      rangePreset: z.enum(['last30', 'last90', 'last180']).optional().describe('Used when from/to are omitted. Defaults to last90.'),
    },
    handler: async (args, ctx) => {
      const config = clinicianReportConfigSchema.parse(
        args.from && args.to
          ? { template: 'full', rangePreset: 'custom', from: args.from, to: args.to }
          : { template: 'full', rangePreset: args.rangePreset ?? 'last90' },
      );

      const model = await getClinicianReportModel(ctx.userId, config);
      const text = htmlToText(renderClinicianReportHtml(model));

      return {
        summary: `Clinician report generated (${text.length} characters).`,
        data: { report: text },
      };
    },
  });

  registerTool(server, {
    name: 'list_appointment_preps',
    description:
      'List the user\'s appointment preparation drafts — the notes and questions they are '
      + 'assembling for an upcoming doctor visit.',
    scope: MCP_SCOPES.READ,
    readOnly: true,
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('Max drafts to return (default 20).'),
    },
    handler: async (args, ctx) => {
      const drafts = await appointmentPrepService.listDrafts(ctx.userId);
      const limited = drafts.slice(0, args.limit ?? 20);

      return {
        summary: `${limited.length} appointment prep draft(s).`,
        data: {
          returned: limited.length,
          truncated: drafts.length > limited.length,
          drafts: limited,
        },
      };
    },
  });

  registerTool(server, {
    name: 'get_appointment_prep',
    description: 'Get one appointment preparation draft in full, by id.',
    scope: MCP_SCOPES.READ,
    readOnly: true,
    inputSchema: {
      id: z.string().guid().describe('The draft id, from list_appointment_preps.'),
    },
    handler: async (args, ctx) => {
      const draft = await appointmentPrepService.getDraft(ctx.userId, args.id);

      if (!draft) {
        return {
          summary: 'No appointment prep draft with that id.',
          data: { code: 'NOT_FOUND' },
        };
      }

      return {
        summary: 'Appointment prep draft.',
        data: draft,
      };
    },
  });
}
