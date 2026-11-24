import type { ClinicianAttackRow, ClinicianReportModel } from '@/services/reports/clinician/model';
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';

import { DateTime } from 'luxon';
import { AppointmentPrepPdfDocument } from '@/services/reports/clinician/appointmentPrepPdf';

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 34,
    paddingHorizontal: 26,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: { fontSize: 16, marginBottom: 6, fontWeight: 700 },
  subheader: { fontSize: 11, marginBottom: 10 },
  sectionTitle: { fontSize: 12, marginBottom: 6, fontWeight: 700 },
  row: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  box: { border: '1 solid #DADADA', borderRadius: 3, padding: 6, flexGrow: 1, flexBasis: 0 },
  label: { fontSize: 8, color: '#666' },
  value: { fontSize: 11, marginTop: 2 },
  table: { border: '1 solid #DADADA', borderRight: 0, borderBottom: 0, marginTop: 4 },
  tr: { flexDirection: 'row' },
  th: { borderRight: '1 solid #DADADA', borderBottom: '1 solid #DADADA', padding: 4, fontSize: 8, fontWeight: 700 },
  td: { borderRight: '1 solid #DADADA', borderBottom: '1 solid #DADADA', padding: 4, fontSize: 8 },
  footer: {
    position: 'absolute',
    left: 26,
    right: 26,
    bottom: 14,
    fontSize: 8,
    color: '#666',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  listItem: { marginBottom: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  barLabel: { width: 72, fontSize: 8 },
  bar: { height: 8, backgroundColor: '#4A84E8' },
  barCount: { width: 26, fontSize: 8, textAlign: 'right' },
});

function Footer({ generatedAtIso }: { generatedAtIso: string }) {
  const generatedOn = DateTime.fromISO(generatedAtIso).toFormat('yyyy-LL-dd HH:mm');
  return (
    <View style={styles.footer} fixed>
      <Text>
        Generated on
        {generatedOn}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
    </View>
  );
}

export function CoverPage({ model }: { model: ClinicianReportModel }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>{model.title}</Text>
      <Text style={styles.subheader}>Clinician export</Text>
      <Text style={styles.paragraph}>
        Date range:
        {model.range.label}
      </Text>
      {model.identity.name && (
        <Text style={styles.paragraph}>
          Patient:
          {model.identity.name}
        </Text>
      )}
      <Text style={styles.paragraph}>
        Timezone:
        {model.timezone}
      </Text>
      <Footer generatedAtIso={model.generatedAtIso} />
    </Page>
  );
}

export function SummaryPage({ model }: { model: ClinicianReportModel }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Summary</Text>
      <Text style={styles.subheader}>{model.range.label}</Text>

      {model.appointmentPrep && (
        <>
          <Text style={styles.sectionTitle}>Visit prep</Text>
          <Text style={styles.paragraph}>
            Appointment date:
            {' '}
            {model.appointmentPrep.appointmentDate}
          </Text>
          <Text style={styles.paragraph}>
            Visit label:
            {' '}
            {model.appointmentPrep.visitLabel || 'Upcoming appointment'}
          </Text>
          <Text style={styles.paragraph}>
            Clinician:
            {' '}
            {model.appointmentPrep.clinicianName || 'Not added'}
          </Text>
          {model.appointmentPrep.visitReason && (
            <Text style={styles.paragraph}>
              Reason for visit:
              {' '}
              {model.appointmentPrep.visitReason}
            </Text>
          )}
          <Text style={styles.paragraph}>
            Top concerns:
            {' '}
            {model.appointmentPrep.topConcerns.join(' | ') || 'None added'}
          </Text>
          <Text style={styles.paragraph}>
            Questions for doctor:
            {' '}
            {model.appointmentPrep.doctorQuestions.join(' | ') || 'None added'}
          </Text>
        </>
      )}

      <View style={styles.row}>
        <View style={styles.box}>
          <Text style={styles.label}>Tracked days quality</Text>
          <Text style={styles.value}>{model.dataQuality.qualityLine}</Text>
        </View>
        <View style={styles.box}>
          <Text style={styles.label}>MMD</Text>
          <Text style={styles.value}>{model.outcomes.mmd}</Text>
        </View>
        <View style={styles.box}>
          <Text style={styles.label}>MHD</Text>
          <Text style={styles.value}>{model.outcomes.mhd}</Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.box}>
          <Text style={styles.label}>Acute medication days</Text>
          <Text style={styles.value}>{model.outcomes.acuteMedicationDays}</Text>
        </View>
        <View style={styles.box}>
          <Text style={styles.label}>MOH status</Text>
          <Text style={styles.value}>{model.moh.status.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.paragraph}>{model.moh.text}</Text>

      <Text style={styles.sectionTitle}>Questionnaires snapshot</Text>
      <View style={styles.row}>
        <View style={styles.box}>
          <Text style={styles.label}>HIT-6</Text>
          <Text style={styles.value}>{model.questionnaires.hit6.score ?? 'N/A'}</Text>
        </View>
        <View style={styles.box}>
          <Text style={styles.label}>MIDAS</Text>
          <Text style={styles.value}>{model.questionnaires.midas.score ?? 'N/A'}</Text>
        </View>
        <View style={styles.box}>
          <Text style={styles.label}>MSQ</Text>
          <Text style={styles.value}>{model.questionnaires.msq.score ?? 'N/A'}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Medication snapshot</Text>
      <Text style={styles.paragraph}>
        Current preventives:
        {' '}
        {model.medications.currentPreventives.join(', ') || 'None'}
      </Text>
      <Text style={styles.paragraph}>
        Top acute meds:
        {' '}
        {model.medications.topAcuteMeds.map(v => `${v.name} (${v.usageDays}d)`).join(', ') || 'None'}
      </Text>
      <Text style={styles.paragraph}>{model.disclaimers[0]}</Text>
      <Text style={styles.paragraph}>{model.disclaimers[1]}</Text>
      <Footer generatedAtIso={model.generatedAtIso} />
    </Page>
  );
}

export function TrendsPage({ model }: { model: ClinicianReportModel }) {
  const max = Math.max(1, ...model.trends.weeklyAttackStarts.map(v => v.count));
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Trends</Text>
      <Text style={styles.subheader}>Weekly attack starts</Text>
      {model.trends.weeklyAttackStarts.slice(-12).map(point => (
        <View key={point.weekStart} style={styles.barRow}>
          <Text style={styles.barLabel}>{point.weekStart}</Text>
          <View style={[styles.bar, { width: `${Math.round((point.count / max) * 100)}%` }]} />
          <Text style={styles.barCount}>{point.count}</Text>
        </View>
      ))}

      <View style={styles.table}>
        <View style={styles.tr}>
          <Text style={[styles.th, { width: '70%' }]}>Week start</Text>
          <Text style={[styles.th, { width: '30%' }]}>Attack starts</Text>
        </View>
        {model.trends.weeklyAttackStarts.map(point => (
          <View key={point.weekStart} style={styles.tr}>
            <Text style={[styles.td, { width: '70%' }]}>{point.weekStart}</Text>
            <Text style={[styles.td, { width: '30%' }]}>{point.count}</Text>
          </View>
        ))}
      </View>
      <Footer generatedAtIso={model.generatedAtIso} />
    </Page>
  );
}

function AttackTablePage({
  rows,
  pageIndex,
  generatedAtIso,
}: {
  rows: ClinicianAttackRow[];
  pageIndex: number;
  generatedAtIso: string;
}) {
  const attackRowKey = (row: ClinicianAttackRow) =>
    [
      row.date,
      row.durationHours ?? 'na',
      row.maxSeverity,
      row.symptoms.join('|'),
      row.acuteMeds.join('|'),
      row.impact ?? 'na',
      row.effectiveness ?? 'na',
    ].join('::');

  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Attacks table</Text>
      <Text style={styles.subheader}>
        Page
        {pageIndex + 1}
      </Text>
      <View style={styles.table}>
        <View style={styles.tr}>
          <Text style={[styles.th, { width: '14%' }]}>Date</Text>
          <Text style={[styles.th, { width: '10%' }]}>Hours</Text>
          <Text style={[styles.th, { width: '10%' }]}>Severity</Text>
          <Text style={[styles.th, { width: '23%' }]}>Symptoms</Text>
          <Text style={[styles.th, { width: '23%' }]}>Acute meds</Text>
          <Text style={[styles.th, { width: '10%' }]}>Impact</Text>
          <Text style={[styles.th, { width: '10%' }]}>Effect</Text>
        </View>
        {rows.map(row => (
          <View key={attackRowKey(row)} style={styles.tr}>
            <Text style={[styles.td, { width: '14%' }]}>{row.date}</Text>
            <Text style={[styles.td, { width: '10%' }]}>{row.durationHours ?? 'N/A'}</Text>
            <Text style={[styles.td, { width: '10%' }]}>{row.maxSeverity}</Text>
            <Text style={[styles.td, { width: '23%' }]}>{row.symptoms.join(', ') || 'None'}</Text>
            <Text style={[styles.td, { width: '23%' }]}>{row.acuteMeds.join(', ') || 'None'}</Text>
            <Text style={[styles.td, { width: '10%' }]}>{row.impact ?? 'N/A'}</Text>
            <Text style={[styles.td, { width: '10%' }]}>{row.effectiveness ?? 'N/A'}</Text>
          </View>
        ))}
      </View>
      <Footer generatedAtIso={generatedAtIso} />
    </Page>
  );
}

export function AttacksTablePages({ model }: { model: ClinicianReportModel }) {
  if (model.attacks.pages.length === 0) {
    return (
      <Page size="A4" style={styles.page}>
        <Text style={styles.header}>Attacks table</Text>
        <Text style={styles.paragraph}>No attacks in selected range.</Text>
        <Footer generatedAtIso={model.generatedAtIso} />
      </Page>
    );
  }
  return model.attacks.pages.map((rows, idx) => (
    <AttackTablePage
      key={`attacks-${rows[0]?.date ?? 'empty'}-${rows[rows.length - 1]?.date ?? 'empty'}-${rows.length}`}
      rows={rows}
      pageIndex={idx}
      generatedAtIso={model.generatedAtIso}
    />
  ));
}

export function MedsPage({ model }: { model: ClinicianReportModel }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Medications</Text>
      <Text style={styles.sectionTitle}>Current preventives</Text>
      {model.medications.currentPreventives.length
        ? model.medications.currentPreventives.map(item => (
            <Text key={item} style={styles.listItem}>
              -
              {item}
            </Text>
          ))
        : <Text style={styles.listItem}>- None</Text>}
      <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Top acute medications by usage days</Text>
      {model.medications.topAcuteMeds.length
        ? model.medications.topAcuteMeds.map(item => (
            <Text key={item.name} style={styles.listItem}>
              -
              {item.name}
              :
              {item.usageDays}
              {' '}
              days
            </Text>
          ))
        : <Text style={styles.listItem}>- None</Text>}
      <Footer generatedAtIso={model.generatedAtIso} />
    </Page>
  );
}

export function DiaryPage({ model }: { model: ClinicianReportModel }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Diary</Text>
      <View style={styles.table}>
        <View style={styles.tr}>
          <Text style={[styles.th, { width: '34%' }]}>Date</Text>
          <Text style={[styles.th, { width: '33%' }]}>Day type</Text>
          <Text style={[styles.th, { width: '33%' }]}>Impact</Text>
        </View>
        {model.diary.days.slice(-120).map(day => (
          <View key={day.date} style={styles.tr}>
            <Text style={[styles.td, { width: '34%' }]}>{day.date}</Text>
            <Text style={[styles.td, { width: '33%' }]}>{day.dayType}</Text>
            <Text style={[styles.td, { width: '33%' }]}>{day.impact ?? 'N/A'}</Text>
          </View>
        ))}
      </View>
      <Footer generatedAtIso={model.generatedAtIso} />
    </Page>
  );
}

export function InsightsPage({ model }: { model: ClinicianReportModel }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Conservative insights</Text>
      <Text style={styles.paragraph}>
        - Data quality:
        {model.dataQuality.qualityLine}
      </Text>
      <Text style={styles.paragraph}>
        - MOH guardrail:
        {model.moh.status.toUpperCase()}
      </Text>
      <Text style={styles.paragraph}>
        - Acute medication days:
        {model.outcomes.acuteMedicationDays}
      </Text>
      <Text style={styles.paragraph}>{model.disclaimers[0]}</Text>
      <Text style={styles.paragraph}>{model.disclaimers[1]}</Text>
      <Footer generatedAtIso={model.generatedAtIso} />
    </Page>
  );
}

export function CycleHormonesPage({ model }: { model: ClinicianReportModel }) {
  const cycle = model.cycleHormones;
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Cycle & hormones</Text>
      {!cycle && (
        <Text style={styles.paragraph}>Cycle section is disabled for this report.</Text>
      )}
      {cycle && (
        <>
          <Text style={styles.paragraph}>
            {cycle.attacksInWindow}
            {' of '}
            {cycle.totalAttacks}
            {' migraine attacks occurred in '}
            {cycle.windowStart}
            ..
            {cycle.windowEnd}
            {' days from bleed start.'}
          </Text>
          {cycle.hormoneProfile && (
            <Text style={styles.paragraph}>
              Hormone profile:
              {' '}
              {cycle.hormoneProfile}
            </Text>
          )}
          <Text style={styles.sectionTitle}>Relative-day attack frequency</Text>
          {cycle.histogram.map(row => (
            <Text key={`hist-${row.relativeDay}`} style={styles.listItem}>
              {row.relativeDay}
              :
              {' '}
              {row.count}
            </Text>
          ))}
          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Last 90 days timeline</Text>
          <View style={styles.table}>
            <View style={styles.tr}>
              <Text style={[styles.th, { width: '34%' }]}>Date</Text>
              <Text style={[styles.th, { width: '33%' }]}>Bleeding</Text>
              <Text style={[styles.th, { width: '33%' }]}>Migraine</Text>
            </View>
            {cycle.timeline.slice(-90).map(day => (
              <View key={`cycle-${day.date}`} style={styles.tr}>
                <Text style={[styles.td, { width: '34%' }]}>{day.date}</Text>
                <Text style={[styles.td, { width: '33%' }]}>{day.bleeding ? 'Yes' : 'No'}</Text>
                <Text style={[styles.td, { width: '33%' }]}>{day.migraine ? 'Yes' : 'No'}</Text>
              </View>
            ))}
          </View>
        </>
      )}
      <Footer generatedAtIso={model.generatedAtIso} />
    </Page>
  );
}

export function ClinicianReportPdfDocument({ model }: { model: ClinicianReportModel }) {
  if (model.appointmentPrep) {
    return <AppointmentPrepPdfDocument model={model} />;
  }

  const show = (id: string) => model.sections.includes(id);
  return (
    <Document>
      {show('cover') && <CoverPage model={model} />}
      {show('summary') && <SummaryPage model={model} />}
      {show('trends') && <TrendsPage model={model} />}
      {show('attacks') && <AttacksTablePages model={model} />}
      {show('medications') && <MedsPage model={model} />}
      {show('diary') && <DiaryPage model={model} />}
      {show('insights') && <InsightsPage model={model} />}
      {show('cycle_hormones') && <CycleHormonesPage model={model} />}
    </Document>
  );
}
