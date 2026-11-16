import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { appointmentPrepSchema, doctorShareLinkSchema, episodeSchema, medicationIntakesSchema, medicationsCatalogSchema, questionnaireResponseSchema, userMedicationsSchema, userSchema } from '@/models/Schema';
import { dbDateToYmd } from '@/services/localDate';
import { outcomesService } from '@/services/OutcomesService';
import { normalizeToPainLevel } from '@/utils/painLevel';

/**
 * Shared episode type - excludes sensitive fields like userId
 */
type SharedEpisode = {
  id: number;
  attackType: 'migraine' | 'headache';
  startTime: string;
  endTime: string | null;
  isOngoing: boolean;
  intensity: number | null;
  painLocation: string;
  painLocationOther: string | null;
  painType: string;
  painTypeOther: string | null;
  symptoms: string[];
  symptomsOther: string | null;
  medicationIntakes: Array<{ label: string; dose: string | null; unit: string | null; takenAt: string }>;
  triggers: string[];
  triggersOther: string | null;
  notes: string | null;
  weatherContext: {
    wpiScore: number;
    wpiLevel: string;
    kpIndex: number | null;
    deltaPressure: number;
    humidity: number;
  } | null;
};

/**
 * GET /api/share/[token] - Public endpoint to validate token and get shared data
 *
 * Security considerations:
 * - No authentication required (public endpoint)
 * - Token validation includes expiration and revocation checks
 * - Only returns data owned by the user who created the share link
 * - Access is logged for audit purposes
 * - No sensitive identifiers exposed (no user IDs, only display names)
 */
export async function GET(_request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  try {
    const { token } = params;

    if (!token || token.length < 20) {
      return NextResponse.json(
        { error: 'Invalid token', code: 'INVALID_TOKEN' },
        { status: 400 },
      );
    }

    // Find the share link
    const [shareLink] = await db
      .select()
      .from(doctorShareLinkSchema)
      .where(eq(doctorShareLinkSchema.token, token))
      .limit(1);

    if (!shareLink) {
      return NextResponse.json(
        { error: 'Link not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Check if link is revoked
    if (shareLink.isRevoked) {
      return NextResponse.json(
        { error: 'This link has been revoked', code: 'REVOKED' },
        { status: 403 },
      );
    }

    // Check if link is expired
    if (new Date() > shareLink.expiresAt) {
      return NextResponse.json(
        { error: 'This link has expired', code: 'EXPIRED' },
        { status: 403 },
      );
    }

    // Update access count and last accessed timestamp
    await db
      .update(doctorShareLinkSchema)
      .set({
        accessCount: sql`${doctorShareLinkSchema.accessCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(eq(doctorShareLinkSchema.id, shareLink.id));

    // Fetch patient's preferred language
    const [user] = await db
      .select({ preferredLanguage: userSchema.preferredLanguage })
      .from(userSchema)
      .where(eq(userSchema.id, shareLink.userId))
      .limit(1);

    const patientPreferredLanguage = user?.preferredLanguage || 'en';

    const [appointmentPrep] = shareLink.appointmentPrepId
      ? await db
          .select({
            appointmentDate: appointmentPrepSchema.appointmentDate,
            visitLabel: appointmentPrepSchema.visitLabel,
            clinicianName: appointmentPrepSchema.clinicianName,
            visitReason: appointmentPrepSchema.visitReason,
            topConcerns: appointmentPrepSchema.topConcerns,
            doctorQuestions: appointmentPrepSchema.doctorQuestions,
            personalNotes: appointmentPrepSchema.personalNotes,
            generatedSnapshot: appointmentPrepSchema.generatedSnapshot,
          })
          .from(appointmentPrepSchema)
          .where(
            and(
              eq(appointmentPrepSchema.id, shareLink.appointmentPrepId),
              eq(appointmentPrepSchema.userId, shareLink.userId),
            ),
          )
          .limit(1)
      : [null];

    // Build episode query with optional date range filters
    const conditions = [eq(episodeSchema.userId, shareLink.userId)];

    if (shareLink.dateRangeStart) {
      conditions.push(gte(episodeSchema.startTime, shareLink.dateRangeStart));
    }
    if (shareLink.dateRangeEnd) {
      conditions.push(lte(episodeSchema.startTime, shareLink.dateRangeEnd));
    }

    // Fetch episodes
    const episodes = await db
      .select()
      .from(episodeSchema)
      .where(and(...conditions))
      .orderBy(desc(episodeSchema.startTime));

    const episodeIds = episodes.map(e => e.id);

    const intakes = episodeIds.length === 0
      ? []
      : await db
          .select({
            episodeId: medicationIntakesSchema.episodeId,
            takenAt: medicationIntakesSchema.takenAt,
            dose: medicationIntakesSchema.dose,
            unit: medicationIntakesSchema.unit,
            medicationName: medicationIntakesSchema.medicationName,
            customName: userMedicationsSchema.customName,
            canonicalName: medicationsCatalogSchema.canonicalName,
          })
          .from(medicationIntakesSchema)
          .leftJoin(
            userMedicationsSchema,
            eq(medicationIntakesSchema.userMedicationId, userMedicationsSchema.id),
          )
          .leftJoin(
            medicationsCatalogSchema,
            eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
          )
          .where(
            and(
              eq(medicationIntakesSchema.userId, shareLink.userId),
              inArray(medicationIntakesSchema.episodeId, episodeIds),
            ),
          )
          .orderBy(desc(medicationIntakesSchema.takenAt));

    const intakesByEpisode = new Map<number, typeof intakes>();
    for (const mi of intakes) {
      if (!mi.episodeId) {
        continue;
      }
      const arr = intakesByEpisode.get(mi.episodeId) ?? [];
      arr.push(mi);
      intakesByEpisode.set(mi.episodeId, arr);
    }

    // Transform episodes to remove internal IDs and add computed fields
    const transformedEpisodes: SharedEpisode[] = episodes.map(ep => ({
      id: ep.id,
      attackType: (ep as any).attackType === 'headache' ? 'headache' : 'migraine',
      startTime: ep.startTime.toISOString(),
      endTime: ep.endTime?.toISOString() || null,
      isOngoing: ep.isOngoing,
      intensity: normalizeToPainLevel(ep.intensity),
      painLocation: ep.painLocation,
      painLocationOther: ep.painLocationOther,
      painType: ep.painType,
      painTypeOther: ep.painTypeOther,
      symptoms: ep.symptoms || [],
      symptomsOther: ep.symptomsOther,
      medicationIntakes: (intakesByEpisode.get(ep.id) ?? []).map((mi) => {
        const label = (mi.medicationName ?? mi.customName ?? mi.canonicalName ?? '').trim() || 'Medication';
        return {
          label,
          dose: mi.dose ?? null,
          unit: mi.unit ?? null,
          takenAt: mi.takenAt.toISOString(),
        };
      }),
      triggers: ep.triggers || [],
      triggersOther: ep.triggersOther,
      notes: ep.notes,
      weatherContext: ep.weatherContext
        ? {
            wpiScore: ep.weatherContext.wpiScore,
            wpiLevel: ep.weatherContext.wpiLevel,
            kpIndex: ep.weatherContext.kpIndex,
            deltaPressure: ep.weatherContext.deltaPressure,
            humidity: ep.weatherContext.humidity,
          }
        : null,
    }));

    // Calculate summary statistics
    const summary = calculateSummary(transformedEpisodes);

    // Doctor-grade outcomes (last 28d and 90d) + monthly trend (12m)
    const [last28, last90, monthly] = await Promise.all([
      outcomesService.computeOutcomes({ userId: shareLink.userId, windowDays: 28 }),
      outcomesService.computeOutcomes({ userId: shareLink.userId, windowDays: 90 }),
      outcomesService.computeMonthly({ userId: shareLink.userId, months: 12 }),
    ]);

    // Medication summary (based on medication intakes in last 90 days)
    const meds90Start = DateTime.now().setZone(last90.timezone).startOf('day').minus({ days: 89 }).toUTC().toJSDate();
    const meds90EndExclusive = DateTime.now().setZone(last90.timezone).plus({ days: 1 }).startOf('day').toUTC().toJSDate();
    const meds90 = await db
      .select({
        takenAt: medicationIntakesSchema.takenAt,
        medicationName: medicationIntakesSchema.medicationName,
        customName: userMedicationsSchema.customName,
        canonicalName: medicationsCatalogSchema.canonicalName,
      })
      .from(medicationIntakesSchema)
      .leftJoin(
        userMedicationsSchema,
        eq(medicationIntakesSchema.userMedicationId, userMedicationsSchema.id),
      )
      .leftJoin(
        medicationsCatalogSchema,
        eq(userMedicationsSchema.catalogMedicationId, medicationsCatalogSchema.id),
      )
      .where(
        and(
          eq(medicationIntakesSchema.userId, shareLink.userId),
          gte(medicationIntakesSchema.takenAt, meds90Start),
          lt(medicationIntakesSchema.takenAt, meds90EndExclusive),
        ),
      );

    const medSummaryMap = new Map<string, { name: string; uses: number }>();
    for (const m of meds90) {
      const name = (m.medicationName ?? m.customName ?? m.canonicalName ?? '').trim();
      if (!name) {
        continue;
      }
      const row = medSummaryMap.get(name) ?? { name, uses: 0 };
      row.uses += 1;
      medSummaryMap.set(name, row);
    }
    const medicationSummary = [...medSummaryMap.values()].sort((a, b) => b.uses - a.uses);

    // Questionnaires (latest + trends)
    const qr = await db
      .select({
        id: questionnaireResponseSchema.id,
        type: questionnaireResponseSchema.type,
        takenAt: questionnaireResponseSchema.takenAt,
        scoreTotal: questionnaireResponseSchema.scoreTotal,
        scoreDetails: questionnaireResponseSchema.scoreDetails,
      })
      .from(questionnaireResponseSchema)
      .where(eq(questionnaireResponseSchema.userId, shareLink.userId))
      .orderBy(desc(questionnaireResponseSchema.takenAt))
      .limit(200);

    type AllowedQrType = 'HIT6' | 'MIDAS' | 'MSQ21';
    const byType: Record<AllowedQrType, any[]> = { HIT6: [], MIDAS: [], MSQ21: [] };
    for (const r of qr) {
      if (r.type === 'HIT6' || r.type === 'MIDAS' || r.type === 'MSQ21') {
        byType[r.type].push({
          id: r.id,
          type: r.type,
          takenAt: r.takenAt.toISOString(),
          scoreTotal: r.scoreTotal ?? null,
          scoreDetails: r.scoreDetails ?? null,
        });
      }
    }

    return NextResponse.json({
      patientDisplayName: shareLink.patientDisplayName || 'Patient',
      recipientName: shareLink.recipientName,
      expiresAt: shareLink.expiresAt.toISOString(),
      patientPreferredLanguage,
      appointmentPrep: appointmentPrep
        ? {
            appointmentDate: dbDateToYmd(appointmentPrep.appointmentDate),
            visitLabel: appointmentPrep.visitLabel ?? null,
            clinicianName: appointmentPrep.clinicianName ?? null,
            visitReason: appointmentPrep.visitReason ?? null,
            topConcerns: appointmentPrep.topConcerns ?? [],
            doctorQuestions: appointmentPrep.doctorQuestions ?? [],
            personalNotes: appointmentPrep.personalNotes ?? null,
            generatedSnapshot: appointmentPrep.generatedSnapshot,
          }
        : null,
      dateRange: {
        start: shareLink.dateRangeStart?.toISOString() || null,
        end: shareLink.dateRangeEnd?.toISOString() || null,
      },
      summary,
      episodes: transformedEpisodes,
      doctorGrade: {
        outcomes: {
          last28,
          last90,
          monthly,
        },
        medicationSummary,
        questionnaires: {
          hit6: byType.HIT6,
          midas: byType.MIDAS,
          msq21: byType.MSQ21,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching shared data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data', code: 'SERVER_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * Calculate summary statistics from episodes
 */
function calculateSummary(episodes: SharedEpisode[]) {
  if (episodes.length === 0) {
    return {
      totalEpisodes: 0,
      episodesThisMonth: 0,
      averageIntensity: 0,
      averageDurationMinutes: null,
      mostCommonTrigger: null,
      mostCommonSymptom: null,
      mostCommonMedication: null,
      weeklyTrend: [],
    };
  }

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const episodesThisMonth = episodes.filter(
    ep => new Date(ep.startTime) >= thisMonthStart,
  ).length;

  // Average pain level (ignore missing/legacy invalid values)
  const intensityValues = episodes.map(ep => ep.intensity).filter((v): v is number => typeof v === 'number');
  const avgIntensity = intensityValues.length > 0
    ? intensityValues.reduce((sum, v) => sum + v, 0) / intensityValues.length
    : 0;

  // Average duration (only for completed episodes)
  const completedEpisodes = episodes.filter(ep => ep.endTime && !ep.isOngoing);
  let averageDurationMinutes: number | null = null;
  if (completedEpisodes.length > 0) {
    const totalDuration = completedEpisodes.reduce((sum, ep) => {
      const start = new Date(ep.startTime);
      const end = new Date(ep.endTime!);
      return sum + (end.getTime() - start.getTime());
    }, 0);
    averageDurationMinutes = Math.round(
      totalDuration / completedEpisodes.length / (1000 * 60),
    );
  }

  // Most common trigger
  const triggerCounts: Record<string, number> = {};
  episodes.forEach((ep) => {
    ep.triggers.forEach((trigger) => {
      triggerCounts[trigger] = (triggerCounts[trigger] || 0) + 1;
    });
  });
  const mostCommonTrigger
    = Object.entries(triggerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Most common symptom
  const symptomCounts: Record<string, number> = {};
  episodes.forEach((ep) => {
    ep.symptoms.forEach((symptom) => {
      symptomCounts[symptom] = (symptomCounts[symptom] || 0) + 1;
    });
  });
  const mostCommonSymptom
    = Object.entries(symptomCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Most common medication
  const medCounts: Record<string, number> = {};
  episodes.forEach((ep) => {
    ep.medicationIntakes.forEach((mi) => {
      medCounts[mi.label] = (medCounts[mi.label] || 0) + 1;
    });
  });
  const mostCommonMedication
    = Object.entries(medCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Weekly trend (last 8 weeks)
  const weeklyTrend: { week: string; count: number; avgIntensity: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i * 7 + weekStart.getDay()));
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekEpisodes = episodes.filter((ep) => {
      const epDate = new Date(ep.startTime);
      return epDate >= weekStart && epDate < weekEnd;
    });

    weeklyTrend.push({
      week: weekStart.toISOString().split('T')[0]!,
      count: weekEpisodes.length,
      avgIntensity:
        weekEpisodes.length > 0
          ? Math.round(
            (weekEpisodes
              .map(ep => ep.intensity)
              .filter((v): v is number => typeof v === 'number')
              .reduce((sum, v) => sum + v, 0)
              / Math.max(1, weekEpisodes.filter(ep => typeof ep.intensity === 'number').length))
            * 10,
          ) / 10
          : 0,
    });
  }

  return {
    totalEpisodes: episodes.length,
    episodesThisMonth,
    averageIntensity: Math.round(avgIntensity * 10) / 10,
    averageDurationMinutes,
    mostCommonTrigger,
    mostCommonSymptom,
    mostCommonMedication,
    weeklyTrend,
  };
}
