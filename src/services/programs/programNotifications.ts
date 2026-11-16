import type { ProgramNotificationKind } from '@/models/Schema';

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import {
  programNotificationLogSchema,
} from '@/models/Schema';
import { pushService } from '@/server/push/push.service';

type CommonArgs = {
  userId: string;
  programId: string;
  localDate: string; // user-local YYYY-MM-DD
};

/**
 * Returns true if a notification of the given kind has already been sent
 * for the user on the given local date.
 */
async function alreadySentToday(args: CommonArgs & { kind: ProgramNotificationKind }) {
  const [row] = await db
    .select({ id: programNotificationLogSchema.id })
    .from(programNotificationLogSchema)
    .where(
      and(
        eq(programNotificationLogSchema.userId, args.userId),
        eq(programNotificationLogSchema.programId, args.programId),
        eq(programNotificationLogSchema.kind, args.kind),
        eq(programNotificationLogSchema.localDate, args.localDate),
      ),
    )
    .limit(1);
  return !!row;
}

async function alreadySentForAttack(args: { userId: string; attackId: number; kind: ProgramNotificationKind }) {
  const [row] = await db
    .select({ id: programNotificationLogSchema.id })
    .from(programNotificationLogSchema)
    .where(
      and(
        eq(programNotificationLogSchema.userId, args.userId),
        eq(programNotificationLogSchema.kind, args.kind),
        eq(programNotificationLogSchema.attackId, args.attackId),
      ),
    )
    .limit(1);
  return !!row;
}

async function logSent(
  args: CommonArgs & { kind: ProgramNotificationKind; attackId?: number },
) {
  await db.insert(programNotificationLogSchema).values({
    userId: args.userId,
    programId: args.programId,
    kind: args.kind,
    localDate: args.localDate,
    attackId: args.attackId ?? null,
  });
}

/**
 * Wind-down reminder: 30 min before user's target bed time.
 * Daily, idempotent.
 */
export async function sendWindDown(args: CommonArgs & { bedTime: string }) {
  if (await alreadySentToday({ ...args, kind: 'wind_down' })) {
    return;
  }
  const result = await pushService.sendToUser(args.userId, {
    title: 'Wind down 🌙',
    body: `Bed time in 30 min (target ${args.bedTime}).`,
    tag: 'sleep-wind-down',
    data: {
      url: '/dashboard',
      deepLink: '/dashboard',
    },
  });
  if (result.sentCount > 0) {
    await logSent({ ...args, kind: 'wind_down' });
  } else {
    logger.debug({ userId: args.userId }, 'wind-down: no subscriptions');
  }
}

/**
 * Morning check-in: 30 min after target wake time.
 * Daily, idempotent. Action buttons fill diary; iOS deep-link does the same.
 */
export async function sendMorningCheckIn(args: CommonArgs & { bedTime: string; wakeTime: string }) {
  if (await alreadySentToday({ ...args, kind: 'morning_check_in' })) {
    return;
  }
  const deepLinkOnTarget = `/quick/sleep?d=${args.localDate}&v=on_target`;
  const result = await pushService.sendToUser(args.userId, {
    title: 'How did you sleep?',
    body: `Target ${args.bedTime}–${args.wakeTime}. Tap to log.`,
    tag: `sleep-morning-${args.localDate}`,
    actions: [
      { action: 'on_target', title: '😴 On target' },
      { action: 'skip', title: 'Skip' },
    ],
    data: {
      url: deepLinkOnTarget,
      deepLink: deepLinkOnTarget,
      programAction: {
        endpoint: '/api/programs/sleep-regularity/log',
        body: { localDate: args.localDate },
      },
    },
  });
  if (result.sentCount > 0) {
    await logSent({ ...args, kind: 'morning_check_in' });
  }
}

/**
 * Weekly digest: Sunday evening summary.
 * Idempotent per (user, program, localDate). The localDate the caller passes
 * is the firing day (a Sunday) — not the week being summarised.
 */
export async function sendWeeklyDigest(args: CommonArgs & {
  adherencePct: number; // 0..100
  daysToReview: number; // days remaining until eval-complete
}) {
  if (await alreadySentToday({ ...args, kind: 'weekly_digest' })) {
    return;
  }
  const result = await pushService.sendToUser(args.userId, {
    title: 'Your week so far',
    body: `${args.adherencePct}% adherence · ${args.daysToReview} days to review.`,
    tag: `digest-${args.programId}-${args.localDate}`,
    data: {
      url: `/dashboard/programs/${args.programId}/progress`,
      deepLink: `/dashboard/programs/${args.programId}/progress`,
    },
  });
  if (result.sentCount > 0) {
    await logSent({ ...args, kind: 'weekly_digest' });
  }
}

/**
 * Eval-complete: fired the day the evaluation window ends.
 * Idempotent per (user, program, localDate=evaluationWindowEnd).
 */
export async function sendEvalComplete(args: CommonArgs & { programTitle: string }) {
  if (await alreadySentToday({ ...args, kind: 'eval_complete' })) {
    return;
  }
  const result = await pushService.sendToUser(args.userId, {
    title: `Your ${args.programTitle} review is ready`,
    body: 'Tap to see how the program went.',
    tag: `eval-complete-${args.programId}`,
    data: {
      url: `/dashboard/programs/${args.programId}/progress`,
      deepLink: `/dashboard/programs/${args.programId}/progress`,
    },
  });
  if (result.sentCount > 0) {
    await logSent({ ...args, kind: 'eval_complete' });
  }
}

/**
 * Onset nudge: 30 min after attack start, if no acute dose logged yet.
 * Once per attack. MOH-aware (caller checks before invoking).
 */
export async function sendOnsetNudge(args: { userId: string; attackId: number; localDate: string }) {
  if (await alreadySentForAttack({ userId: args.userId, attackId: args.attackId, kind: 'onset_nudge' })) {
    return;
  }
  const result = await pushService.sendToUser(args.userId, {
    title: 'Take your acute med soon',
    body: '30 min since attack started. Earlier dosing helps.',
    tag: `onset-${args.attackId}`,
    data: {
      url: '/dashboard',
      deepLink: '/dashboard',
    },
  });
  if (result.sentCount > 0) {
    await logSent({
      userId: args.userId,
      programId: 'acute-med-timing',
      kind: 'onset_nudge',
      localDate: args.localDate,
      attackId: args.attackId,
    });
  }
}
