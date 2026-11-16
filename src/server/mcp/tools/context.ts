import type { McpServer } from '@modelcontextprotocol/server';

import { hasHealthDataConsent } from '@/app/api/_helpers/healthDataConsent';
import { registerTool } from '@/server/mcp/defineTool';
import { MCP_SCOPES } from '@/server/mcp/scopes';
import { episodeService } from '@/services/episodes/EpisodeService';
import { getUserTimezone } from '@/services/userTimezone';

export function registerContextTools(server: McpServer): void {
  registerTool(server, {
    name: 'get_user_context',
    description:
      'Get the current state needed before reading or writing anything else: the user\'s timezone, '
      + 'whether an attack is currently ongoing, and whether they have granted health-data consent. '
      + 'Call this first in a conversation so relative times like "this morning" resolve correctly '
      + 'and so you know whether writes will be permitted.',
    scope: MCP_SCOPES.READ,
    readOnly: true,
    handler: async (_args, ctx) => {
      const [timezone, ongoing, consent] = await Promise.all([
        getUserTimezone(ctx.userId),
        episodeService.getOngoing(ctx.userId),
        hasHealthDataConsent(ctx.userId),
      ]);

      const now = new Date();

      const summary = ongoing
        ? `Timezone ${timezone}. An attack is ongoing (id ${ongoing.id}, ${ongoing.attackType}), started ${ongoing.startTime.toISOString()}.`
        : `Timezone ${timezone}. No attack is currently ongoing.`;

      return {
        summary,
        data: {
          timezone,
          serverTimeUtc: now.toISOString(),
          healthDataConsent: consent,
          ongoingAttack: ongoing
            ? {
                attackId: ongoing.id,
                attackType: ongoing.attackType,
                startTime: ongoing.startTime.toISOString(),
              }
            : null,
        },
      };
    },
  });
}
