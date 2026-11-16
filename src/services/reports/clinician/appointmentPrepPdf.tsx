import type { ClinicianReportModel } from '@/services/reports/clinician/model';
import {
  Circle,
  Document,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
} from '@react-pdf/renderer';

import { DateTime } from 'luxon';

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 24,
    fontSize: 9,
    fontFamily: 'Helvetica',
    backgroundColor: '#F8FAFC',
    color: '#1F2937',
  },
  hero: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    border: '1 solid #E2E8F0',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandName: {
    fontSize: 15,
    fontWeight: 700,
    color: '#1F2937',
  },
  visitPill: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
    border: '1 solid #C7D2FE',
  },
  visitPillText: {
    fontSize: 8,
    color: '#4F46E5',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 21,
    fontWeight: 700,
    marginBottom: 4,
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 9,
    color: '#64748B',
    lineHeight: 1.4,
  },
  identityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  identityCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 9,
    border: '1 solid #E2E8F0',
  },
  identityLabel: {
    fontSize: 8,
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  identityValue: {
    fontSize: 10,
    color: '#1F2937',
    lineHeight: 1.35,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  metricCard: {
    width: '31%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    border: '1 solid #E2E8F0',
  },
  metricLabel: {
    fontSize: 8,
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 700,
    color: '#1F2937',
    marginBottom: 2,
  },
  metricHint: {
    fontSize: 8,
    color: '#64748B',
    lineHeight: 1.35,
  },
  twoColumn: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  column: {
    flex: 1,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    border: '1 solid #E2E8F0',
    minHeight: 170,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
    color: '#1F2937',
  },
  sectionIntro: {
    fontSize: 9,
    color: '#64748B',
    lineHeight: 1.35,
    marginBottom: 6,
  },
  paragraph: {
    fontSize: 9,
    lineHeight: 1.45,
    color: '#1F2937',
    marginBottom: 6,
  },
  bulletList: {
    gap: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  bullet: {
    fontSize: 11,
    color: '#6366F1',
    marginTop: 1,
  },
  bulletText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 1.4,
    color: '#1F2937',
  },
  visitNote: {
    marginTop: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 10,
    border: '1 solid #E2E8F0',
  },
  visitNoteLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    color: '#4F46E5',
    marginBottom: 4,
  },
  visitNoteText: {
    fontSize: 9,
    lineHeight: 1.45,
    color: '#334155',
  },
  disclaimers: {
    marginTop: 8,
    paddingHorizontal: 2,
  },
  disclaimerText: {
    fontSize: 8,
    lineHeight: 1.35,
    color: '#64748B',
    marginBottom: 2,
  },
  footer: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 10,
    fontSize: 8,
    color: '#64748B',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailHeader: {
    marginBottom: 12,
  },
  detailEyebrow: {
    fontSize: 8,
    color: '#4F46E5',
    textTransform: 'uppercase',
    marginBottom: 4,
    letterSpacing: 0.8,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: '#1F2937',
    marginBottom: 5,
  },
  detailSubtitle: {
    fontSize: 9,
    color: '#64748B',
    lineHeight: 1.4,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailCardHalf: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    border: '1 solid #E2E8F0',
    minHeight: 200,
  },
  detailCardFull: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    border: '1 solid #E2E8F0',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  infoPill: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: '#F5F7FF',
    border: '1 solid #C7D2FE',
  },
  infoPillLabel: {
    fontSize: 8,
    color: '#4F46E5',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  infoPillValue: {
    fontSize: 10,
    color: '#1F2937',
  },
  explanationList: {
    gap: 8,
  },
  explanationCard: {
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#F8FAFC',
    border: '1 solid #E2E8F0',
  },
  explanationTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#1F2937',
    marginBottom: 4,
  },
  explanationText: {
    fontSize: 9,
    lineHeight: 1.45,
    color: '#334155',
  },
  scoreRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  scoreCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    border: '1 solid #E2E8F0',
  },
  scoreLabel: {
    fontSize: 8,
    color: '#7B7B86',
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: 700,
    color: '#1F2937',
    marginBottom: 3,
  },
  scoreHint: {
    fontSize: 9,
    color: '#64748B',
    lineHeight: 1.35,
  },
  visualRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  visualCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    border: '1 solid #E2E8F0',
    minHeight: 240,
  },
  chartColumns: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    height: 108,
    marginTop: 6,
    marginBottom: 10,
  },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  chartValue: {
    fontSize: 9,
    color: '#6366F1',
    marginBottom: 4,
  },
  chartBar: {
    width: 20,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: '#6366F1',
  },
  chartLabel: {
    fontSize: 8,
    color: '#64748B',
    marginTop: 5,
    textAlign: 'center',
  },
  coverageBarTrack: {
    height: 18,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
    flexDirection: 'row',
    marginTop: 10,
    marginBottom: 12,
  },
  coverageRecorded: {
    height: '100%',
    backgroundColor: '#6366F1',
  },
  coverageMissing: {
    height: '100%',
    backgroundColor: '#CBD5E1',
  },
});

function formatGeneratedAt(generatedAtIso: string) {
  return DateTime.fromISO(generatedAtIso).toFormat('yyyy-LL-dd HH:mm');
}

function LogoMark() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4.5} stroke="#1F2937" strokeWidth={2} />
      <Path
        d="M7 21a5 5 0 0 1 10 0"
        stroke="#1F2937"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M12.5 4.5 10.5 8h2L11 11.5"
        stroke="#1F2937"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function Footer({ generatedAtIso }: { generatedAtIso: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        Generated on
        {' '}
        {formatGeneratedAt(generatedAtIso)}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
    </View>
  );
}

type SnapshotExplanation = {
  title: string;
  body: string;
};

function formatKeyLabel(rawKey: string) {
  return rawKey;
}

function formatQuestionnaireScore(score: number | null) {
  return score === null ? 'Not completed' : String(score);
}

function formatAverageIntensity(value: number | null) {
  return value === null ? 'Average intensity was not recorded.' : `Average intensity ${value.toFixed(1)}/10.`;
}

function formatWeekLabel(weekStart: string) {
  return DateTime.fromISO(weekStart).toFormat('LLL dd');
}

function buildSnapshotExplanation(
  key: string,
  model: ClinicianReportModel,
): SnapshotExplanation {
  const snapshot = model.appointmentPrep?.generatedSnapshot;

  if (!snapshot) {
    return {
      title: formatKeyLabel(key),
      body: formatKeyLabel(key),
    };
  }

  switch (key) {
    case 'coverage_summary':
      return {
        title: 'Coverage summary',
        body: `Recorded days: ${snapshot.coverage.recordedDays}/${snapshot.coverage.totalDays} · Missing: ${snapshot.coverage.missingDays} (missing is not counted as headache-free).`,
      };
    case 'attack_summary':
      return {
        title: 'Attack summary',
        body: `${snapshot.attackStats.totalAttacks} attacks logged in the last ${snapshot.compareWindowDays} days. ${formatAverageIntensity(snapshot.attackStats.avgIntensity)}`,
      };
    case 'treatment_adjustment':
      return {
        title: 'Current preventive plan',
        body: `Review whether the current prevention plan matches a recent burden of ${snapshot.currentSnapshot.headacheBurden.migraineDays} migraine days and ${snapshot.currentSnapshot.headacheBurden.headacheDays} headache days.`,
      };
    case 'acute_medication_safety':
      return {
        title: 'Acute medication safety',
        body: `Acute medication was used on ${snapshot.currentSnapshot.acuteMedicationDays} days in this snapshot, which can help frame how often rescue treatment is needed.`,
      };
    default:
      return {
        title: formatKeyLabel(key),
        body: formatKeyLabel(key),
      };
  }
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricHint}>{hint}</Text>
    </View>
  );
}

function BulletList({ items, emptyText }: { items: string[]; emptyText: string }) {
  const values = items.length > 0 ? items : [emptyText];

  return (
    <View style={styles.bulletList}>
      {values.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <View key={`${index}-${item}`} style={styles.bulletRow}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function DetailHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.detailHeader}>
      <Text style={styles.detailEyebrow}>{eyebrow}</Text>
      <Text style={styles.detailTitle}>{title}</Text>
      <Text style={styles.detailSubtitle}>{subtitle}</Text>
    </View>
  );
}

function ExplanationList({
  items,
  emptyText,
}: {
  items: SnapshotExplanation[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <Text style={styles.paragraph}>{emptyText}</Text>;
  }

  return (
    <View style={styles.explanationList}>
      {items.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <View key={`${item.title}-${index}`} style={styles.explanationCard}>
          <Text style={styles.explanationTitle}>{item.title}</Text>
          <Text style={styles.explanationText}>{item.body}</Text>
        </View>
      ))}
    </View>
  );
}

function ScoreCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <View style={styles.scoreCard}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <Text style={styles.scoreValue}>{value}</Text>
      <Text style={styles.scoreHint}>{hint}</Text>
    </View>
  );
}

function WeeklyAttackStartsVisual({
  weeklyAttackStarts,
}: {
  weeklyAttackStarts: ClinicianReportModel['trends']['weeklyAttackStarts'];
}) {
  const maxCount = Math.max(1, ...weeklyAttackStarts.map(entry => entry.count));

  return (
    <View style={styles.chartColumns}>
      {weeklyAttackStarts.map((entry) => {
        const barHeight = Math.max(10, Math.round((entry.count / maxCount) * 72));

        return (
          <View key={entry.weekStart} style={styles.chartColumn}>
            <Text style={styles.chartValue}>{entry.count}</Text>
            <View style={[styles.chartBar, { height: barHeight }]} />
            <Text style={styles.chartLabel}>{formatWeekLabel(entry.weekStart)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function TrackingQualityVisual({
  recordedDays,
  missingDays,
  totalDays,
}: {
  recordedDays: number;
  missingDays: number;
  totalDays: number;
}) {
  const recordedPct = totalDays > 0 ? (recordedDays / totalDays) * 100 : 0;
  const missingPct = totalDays > 0 ? (missingDays / totalDays) * 100 : 0;

  return (
    <View>
      <View style={styles.coverageBarTrack}>
        <View style={[styles.coverageRecorded, { width: `${recordedPct}%` }]} />
        <View style={[styles.coverageMissing, { width: `${missingPct}%` }]} />
      </View>
      <View style={styles.pillRow}>
        <View style={styles.infoPill}>
          <Text style={styles.infoPillLabel}>Recorded</Text>
          <Text style={styles.infoPillValue}>
            {recordedDays}
            {' '}
            days
          </Text>
        </View>
        <View style={styles.infoPill}>
          <Text style={styles.infoPillLabel}>Missing</Text>
          <Text style={styles.infoPillValue}>
            {missingDays}
            {' '}
            days
          </Text>
        </View>
        <View style={styles.infoPill}>
          <Text style={styles.infoPillLabel}>Window</Text>
          <Text style={styles.infoPillValue}>
            {totalDays}
            {' '}
            days
          </Text>
        </View>
      </View>
    </View>
  );
}

export function AppointmentPrepPdfDocument({ model }: { model: ClinicianReportModel }) {
  if (!model.appointmentPrep) {
    throw new Error('AppointmentPrepPdfDocument requires appointment prep data.');
  }

  const { appointmentPrep } = model;
  const preventiveLine = appointmentPrep.generatedSnapshot.currentSnapshot.preventiveNames.join(', ') || 'None listed';
  const trackingLine = `${model.dataQuality.trackedDays}/${model.dataQuality.totalDays} days recorded`;
  const acuteMedicationLine = model.medications.topAcuteMeds.length > 0
    ? model.medications.topAcuteMeds.map(med => `${med.name} (${med.usageDays} days)`).join(', ')
    : 'No acute medications listed';
  const identityName = model.identity.name || 'Patient';
  const visitLabel = appointmentPrep.visitLabel || 'Upcoming appointment';
  const recentChangeExplanations = appointmentPrep.generatedSnapshot.whatChangedKeys.map(key => buildSnapshotExplanation(key, model));
  const questionPromptExplanations = appointmentPrep.generatedSnapshot.questionPromptKeys.map(key => buildSnapshotExplanation(key, model));
  const latestWeeklyAttackCount = model.trends.weeklyAttackStarts.length > 0
    ? Math.max(...model.trends.weeklyAttackStarts.map(entry => entry.count))
    : 0;
  const weeklyAttackCaption = model.trends.weeklyAttackStarts.length > 0
    ? `What to notice: recent weeks range from 0 to ${latestWeeklyAttackCount} logged attack starts, helping the clinician see whether attacks are clustering or staying steady.`
    : 'What to notice: weekly attack start data is not available for this report window yet.';
  const trackingCaption = `What to notice: ${appointmentPrep.generatedSnapshot.coverage.recordedDays} of ${appointmentPrep.generatedSnapshot.coverage.totalDays} days were recorded, so the snapshot is mostly based on tracked days. ${appointmentPrep.generatedSnapshot.coverage.missingDays} days are still missing.`;
  const discussionNotes = [
    `${appointmentPrep.generatedSnapshot.attackStats.totalAttacks} attacks were logged during the snapshot window.`,
    appointmentPrep.generatedSnapshot.attackStats.avgIntensity === null
      ? 'Average attack intensity was not available in the snapshot.'
      : `Average logged attack intensity was ${appointmentPrep.generatedSnapshot.attackStats.avgIntensity.toFixed(1)}/10.`,
    ...questionPromptExplanations.map(item => `${item.title}: ${item.body}`),
  ];
  const visitWhyThisMatters = [
    `${identityName} tracked ${trackingLine.toLowerCase()} in the last ${appointmentPrep.generatedSnapshot.compareWindowDays} days.`,
    `Migraine days are ${appointmentPrep.generatedSnapshot.currentSnapshot.headacheBurden.migraineDays} with ${appointmentPrep.generatedSnapshot.currentSnapshot.headacheBurden.headacheDays} headache days, which helps anchor the visit in recent burden.`,
    appointmentPrep.visitReason || 'This summary keeps the visit focused on the biggest changes the patient wants to discuss.',
  ].join(' ');
  const selectiveVisitNote = questionPromptExplanations[0]?.body
    || recentChangeExplanations[0]?.body
    || 'The generated snapshot highlights a few concrete topics that can help the visit stay focused on recent burden and treatment fit.';
  const disclaimerCounts = new Map<string, number>();
  const disclaimerEntries = model.disclaimers.map((disclaimer) => {
    const nextCount = (disclaimerCounts.get(disclaimer) ?? 0) + 1;
    disclaimerCounts.set(disclaimer, nextCount);
    return {
      disclaimer,
      key: `${disclaimer}-${nextCount}`,
    };
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.brandLockup}>
              <LogoMark />
              <Text style={styles.brandName}>Migrennity</Text>
            </View>
            <View style={styles.visitPill}>
              <Text style={styles.visitPillText}>Appointment prep</Text>
            </View>
          </View>

          <Text style={styles.title}>{visitLabel}</Text>
          <Text style={styles.subtitle}>
            A one-page summary designed to help the visit start with what changed, what matters most,
            and the questions the patient wants answered.
          </Text>

          <View style={styles.identityGrid}>
            <View style={styles.identityCard}>
              <Text style={styles.identityLabel}>Patient</Text>
              <Text style={styles.identityValue}>{identityName}</Text>
            </View>
            <View style={styles.identityCard}>
              <Text style={styles.identityLabel}>Appointment date</Text>
              <Text style={styles.identityValue}>{appointmentPrep.appointmentDate}</Text>
            </View>
            <View style={styles.identityCard}>
              <Text style={styles.identityLabel}>Clinician</Text>
              <Text style={styles.identityValue}>{appointmentPrep.clinicianName || 'Clinician not added'}</Text>
            </View>
            <View style={styles.identityCard}>
              <Text style={styles.identityLabel}>Report window</Text>
              <Text style={styles.identityValue}>{model.range.label}</Text>
            </View>
            <View style={styles.identityCard}>
              <Text style={styles.identityLabel}>Visit label</Text>
              <Text style={styles.identityValue}>{visitLabel}</Text>
            </View>
            <View style={styles.identityCard}>
              <Text style={styles.identityLabel}>Timezone</Text>
              <Text style={styles.identityValue}>{model.timezone}</Text>
            </View>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <MetricCard
            label="Migraine days"
            value={String(appointmentPrep.generatedSnapshot.currentSnapshot.headacheBurden.migraineDays)}
            hint="Recent monthly migraine burden"
          />
          <MetricCard
            label="Headache days"
            value={String(appointmentPrep.generatedSnapshot.currentSnapshot.headacheBurden.headacheDays)}
            hint="All headache days in the snapshot window"
          />
          <MetricCard
            label="Acute medication days"
            value={String(appointmentPrep.generatedSnapshot.currentSnapshot.acuteMedicationDays)}
            hint="Useful for discussing relief and overuse risk"
          />
          <MetricCard
            label="Preventives"
            value={String(appointmentPrep.generatedSnapshot.currentSnapshot.preventiveNames.length)}
            hint={preventiveLine}
          />
          <MetricCard
            label="Tracking quality"
            value={`${model.dataQuality.trackedPct}%`}
            hint={trackingLine}
          />
        </View>

        <View style={styles.twoColumn}>
          <View style={styles.column}>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Why I&apos;m here</Text>
              <Text style={styles.sectionIntro}>
                The patient&apos;s reason for the visit, in their own words, plus the top concerns they
                want the clinician to hear first.
              </Text>
              {appointmentPrep.visitReason && (
                <Text style={styles.paragraph}>{appointmentPrep.visitReason}</Text>
              )}
              <BulletList
                items={appointmentPrep.topConcerns}
                emptyText="No top concerns were added yet."
              />
            </View>
          </View>

          <View style={styles.column}>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Questions for my doctor</Text>
              <Text style={styles.sectionIntro}>
                A short checklist of questions the patient wants to cover before the visit ends.
              </Text>
              <BulletList
                items={appointmentPrep.doctorQuestions}
                emptyText="No questions were added yet."
              />
              {appointmentPrep.personalNotes && (
                <Text style={[styles.paragraph, { marginTop: 10, marginBottom: 0 }]}>
                  Personal notes:
                  {' '}
                  {appointmentPrep.personalNotes}
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.visitNote}>
          <Text style={styles.visitNoteLabel}>Why this matters for the visit</Text>
          <Text style={styles.visitNoteText}>{visitWhyThisMatters}</Text>
        </View>

        <View style={styles.disclaimers}>
          {disclaimerEntries.map(({ disclaimer, key }) => (
            <Text key={key} style={styles.disclaimerText}>
              {disclaimer}
            </Text>
          ))}
        </View>

        <Footer generatedAtIso={model.generatedAtIso} />
      </Page>

      <Page size="A4" style={styles.page}>
        <DetailHeader
          eyebrow="Page 2"
          title="Supporting detail for the visit"
          subtitle="Recent changes, treatment context, and questionnaires in the same warm-clinical summary language."
        />

        <View style={styles.detailGrid}>
          <View style={styles.detailCardHalf}>
            <Text style={styles.sectionTitle}>What changed recently</Text>
            <Text style={styles.sectionIntro}>
              Generated summary points from the current appointment-prep snapshot.
            </Text>
            <ExplanationList
              items={recentChangeExplanations}
              emptyText="No generated change summary was available for this visit."
            />
          </View>

          <View style={styles.detailCardHalf}>
            <Text style={styles.sectionTitle}>Medication and treatment context</Text>
            <Text style={styles.sectionIntro}>
              Current preventives, acute medication use, and the main discussion prompts already captured.
            </Text>
            <View style={styles.pillRow}>
              <View style={styles.infoPill}>
                <Text style={styles.infoPillLabel}>Preventives</Text>
                <Text style={styles.infoPillValue}>{preventiveLine}</Text>
              </View>
              <View style={styles.infoPill}>
                <Text style={styles.infoPillLabel}>Acute medication days</Text>
                <Text style={styles.infoPillValue}>
                  {appointmentPrep.generatedSnapshot.currentSnapshot.acuteMedicationDays}
                </Text>
              </View>
            </View>
            <Text style={[styles.paragraph, { marginTop: 10 }]}>
              Common acute medications:
              {' '}
              {acuteMedicationLine}
            </Text>
            <ExplanationList
              items={questionPromptExplanations}
              emptyText="No treatment discussion prompts were generated."
            />
          </View>

          <View style={styles.detailCardHalf}>
            <Text style={styles.sectionTitle}>Questionnaire scores</Text>
            <Text style={styles.sectionIntro}>
              Latest available questionnaire values included in the appointment-prep snapshot.
            </Text>
            <View style={styles.scoreRow}>
              <ScoreCard
                label="HIT-6"
                value={formatQuestionnaireScore(appointmentPrep.generatedSnapshot.currentSnapshot.questionnaireScores.hit6)}
                hint="Use the most recent headache impact score as supporting context."
              />
              <ScoreCard
                label="MIDAS"
                value={formatQuestionnaireScore(appointmentPrep.generatedSnapshot.currentSnapshot.questionnaireScores.midas)}
                hint="Use the most recent disability score as supporting context."
              />
            </View>
            <Text style={styles.paragraph}>
              These scores are shown as recent supporting context and should be interpreted alongside symptoms and diary coverage.
            </Text>
            <View style={styles.visitNote}>
              <Text style={styles.visitNoteLabel}>Why this matters for the visit</Text>
              <Text style={styles.visitNoteText}>{selectiveVisitNote}</Text>
            </View>
          </View>

          <View style={styles.detailCardHalf}>
            <Text style={styles.sectionTitle}>Personal notes</Text>
            <Text style={styles.sectionIntro}>
              Details the patient wanted to remember or bring into the discussion.
            </Text>
            <Text style={styles.paragraph}>
              {appointmentPrep.personalNotes || 'No personal notes were added for this visit.'}
            </Text>
            <Text style={styles.sectionTitle}>Discussion prompts already saved</Text>
            <Text style={styles.sectionIntro}>
              These prompts come from the appointment-prep snapshot and can help keep the visit focused.
            </Text>
            <BulletList
              items={questionPromptExplanations.map(item => `${item.title}: ${item.body}`)}
              emptyText="No generated prompts were added yet."
            />
          </View>
        </View>

        <Footer generatedAtIso={model.generatedAtIso} />
      </Page>

      <Page size="A4" style={styles.page}>
        <DetailHeader
          eyebrow="Page 3"
          title="Pattern visuals and discussion support"
          subtitle="Compact visuals for recent pattern review, using only data already available in the clinician report model."
        />

        <View style={styles.visualRow}>
          <View style={styles.visualCard}>
            <Text style={styles.sectionTitle}>Recent weekly attack starts</Text>
            <Text style={styles.sectionIntro}>
              Weekly logged attack starts from the recent trend data.
            </Text>
            <WeeklyAttackStartsVisual weeklyAttackStarts={model.trends.weeklyAttackStarts} />
            <Text style={styles.visitNoteLabel}>What to notice</Text>
            <Text style={styles.visitNoteText}>{weeklyAttackCaption}</Text>
          </View>

          <View style={styles.visualCard}>
            <Text style={styles.sectionTitle}>Tracking quality over the snapshot window</Text>
            <Text style={styles.sectionIntro}>
              Recorded versus missing days for the same period used in the appointment-prep snapshot.
            </Text>
            <TrackingQualityVisual
              recordedDays={appointmentPrep.generatedSnapshot.coverage.recordedDays}
              missingDays={appointmentPrep.generatedSnapshot.coverage.missingDays}
              totalDays={appointmentPrep.generatedSnapshot.coverage.totalDays}
            />
            <Text style={styles.visitNoteLabel}>What to notice</Text>
            <Text style={styles.visitNoteText}>{trackingCaption}</Text>
          </View>
        </View>

        <View style={styles.detailCardFull}>
          <Text style={styles.sectionTitle}>Discussion prompts and pattern notes</Text>
          <Text style={styles.sectionIntro}>
            Small supporting notes that can help the clinician connect recent burden, tracking quality, and treatment questions.
          </Text>
          <BulletList
            items={discussionNotes}
            emptyText="No discussion prompts or pattern notes were available."
          />
        </View>

        <Footer generatedAtIso={model.generatedAtIso} />
      </Page>
    </Document>
  );
}
