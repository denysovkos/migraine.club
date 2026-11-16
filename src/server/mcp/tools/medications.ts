import type { McpServer } from '@modelcontextprotocol/server';

import { z } from 'zod';
import { registerTool } from '@/server/mcp/defineTool';
import { MCP_SCOPES } from '@/server/mcp/scopes';
import { acuteDoseService } from '@/services/acuteMedications/AcuteDoseService';
import { resolveUserMedication } from '@/services/medications/resolveUserMedication';
import { quickAddService } from '@/services/QuickAddService';

export function registerMedicationTools(server: McpServer): void {
  registerTool(server, {
    name: 'list_medication_doses',
    description:
      'List acute medication doses the user has taken in a date range, newest first. '
      + 'Use alongside get_moh_status when discussing how often they are medicating.',
    scope: MCP_SCOPES.READ,
    readOnly: true,
    inputSchema: {
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(200).optional().describe('Max doses to return (default 100, max 200).'),
    },
    handler: async (args, ctx) => {
      const limit = Math.min(args.limit ?? 100, 200);
      const doses = await acuteDoseService.list(ctx.userId, {
        from: args.from ?? null,
        to: args.to ?? null,
        limit,
      });

      return {
        summary: `${doses.length} acute dose(s) in range.`,
        data: {
          returned: doses.length,
          truncated: doses.length === limit,
          doses: doses.map(d => ({ ...d, takenAt: d.takenAt.toISOString() })),
        },
      };
    },
  });

  registerTool(server, {
    name: 'log_medication_dose',
    description:
      'Record that the user took a medication. Pass the medication name as the user said it; '
      + 'it is matched against their existing medications and created if new. '
      + 'Acute medications are recorded as acute doses so they count toward medication-overuse '
      + 'tracking, and are linked to the given attack when one is supplied.',
    scope: MCP_SCOPES.WRITE,
    inputSchema: {
      medicationName: z.string().trim().min(1).max(200).optional().describe('Free-text name, e.g. "sumatriptan".'),
      userMedicationId: z.string().guid().optional().describe('Use instead of medicationName when the exact medication id is known.'),
      dose: z.string().trim().min(1).max(100).optional().describe('Amount, e.g. "50".'),
      unit: z.string().trim().min(1).max(50).optional().describe('Unit, e.g. "mg".'),
      takenAt: z.string().datetime().optional().describe('When it was taken, ISO 8601. Defaults to now.'),
      attackId: z.number().int().positive().optional().describe('Link the dose to this attack.'),
      notes: z.string().max(1000).optional(),
    },
    handler: async (args, ctx) => {
      if (!args.medicationName && !args.userMedicationId) {
        throw new z.ZodError([
          {
            code: 'custom',
            path: ['medicationName'],
            message: 'Either medicationName or userMedicationId is required.',
          },
        ] as any);
      }

      const medication = await resolveUserMedication(ctx.userId, args);

      if (medication.isAcute) {
        const result = await acuteDoseService.create(ctx.userId, {
          medicationId: medication.id,
          attackId: args.attackId ?? null,
          takenAt: args.takenAt,
          dose: args.dose ?? null,
          unit: args.unit ?? null,
          notes: args.notes ?? null,
        });

        return {
          summary: result.attackId
            ? `Logged as an acute dose, linked to attack ${result.attackId}.`
            : 'Logged as an acute dose.',
          data: { ...result, kind: 'acute', userMedicationId: medication.id },
        };
      }

      const result = await quickAddService.createMedicationIntake({
        userId: ctx.userId,
        input: {
          userMedicationId: medication.id,
          dose: args.dose,
          unit: args.unit,
          episodeId: args.attackId,
        },
      });

      return {
        summary: result.linkedEpisodeId
          ? `Logged as a preventive/other intake, linked to attack ${result.linkedEpisodeId}.`
          : 'Logged as a preventive/other intake.',
        data: { ...result, kind: 'intake' },
      };
    },
  });
}
