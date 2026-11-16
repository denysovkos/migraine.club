import type { ClinicianReportModel } from '@/services/reports/clinician/model';

import { DateTime } from 'luxon';

function esc(value: string | number | null | undefined): string {
  const str = String(value ?? '');
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function section(title: string, content: string): string {
  return `<section class="section"><h2>${esc(title)}</h2>${content}</section>`;
}

function bulletList(items: string[], emptyText: string): string {
  if (items.length === 0) {
    return `<p class="appt-empty">${esc(emptyText)}</p>`;
  }

  return `<ul class="appt-list">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function formatKeyLabel(key: string): string {
  return key
    .replaceAll('_', ' ')
    .replace(/\b\w/g, value => value.toUpperCase());
}

function formatAverageIntensity(avgIntensity: null | number): string {
  if (avgIntensity === null) {
    return 'Average attack intensity was not available in the snapshot.';
  }

  return `Average logged attack intensity was ${avgIntensity.toFixed(1)}/10.`;
}

function buildSnapshotExplanation(
  key: string,
  model: ClinicianReportModel,
): { title: string; body: string } {
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

function explanationList(
  items: Array<{ title: string; body: string }>,
  emptyText: string,
): string {
  if (items.length === 0) {
    return `<p class="appt-empty">${esc(emptyText)}</p>`;
  }

  return `<ul class="appt-list">${items.map(item => `<li><strong>${esc(item.title)}:</strong> ${esc(item.body)}</li>`).join('')}</ul>`;
}

export function renderClinicianReportHtml(model: ClinicianReportModel): string {
  const generatedOn = DateTime.fromISO(model.generatedAtIso).toFormat('yyyy-LL-dd HH:mm');
  const show = (id: string) => model.sections.includes(id);

  const parts: string[] = [];

  if (model.appointmentPrep) {
    const appointmentPrep = model.appointmentPrep;
    const visitLabel = appointmentPrep.visitLabel || 'Upcoming appointment';
    const preventiveLine = appointmentPrep.generatedSnapshot.currentSnapshot.preventiveNames.join(', ') || 'None listed';
    const trackingLine = `${appointmentPrep.generatedSnapshot.coverage.recordedDays}/${appointmentPrep.generatedSnapshot.coverage.totalDays} days recorded`;
    const recentChangeExplanations = appointmentPrep.generatedSnapshot.whatChangedKeys.map(key => buildSnapshotExplanation(key, model));
    const questionPromptExplanations = appointmentPrep.generatedSnapshot.questionPromptKeys.map(key => buildSnapshotExplanation(key, model));
    const questionScores = [
      appointmentPrep.generatedSnapshot.currentSnapshot.questionnaireScores.hit6 !== null
        ? `HIT-6 ${appointmentPrep.generatedSnapshot.currentSnapshot.questionnaireScores.hit6}`
        : null,
      appointmentPrep.generatedSnapshot.currentSnapshot.questionnaireScores.midas !== null
        ? `MIDAS ${appointmentPrep.generatedSnapshot.currentSnapshot.questionnaireScores.midas}`
        : null,
    ].filter((value): value is string => value !== null);

    parts.push(`
      <section class="section appt-hero">
        <div class="appt-pill">Appointment prep</div>
        <p class="appt-kicker">Warm-clinical visit summary</p>
        <h2 class="appt-title">${esc(visitLabel)}</h2>
        <p class="appt-subtitle">A focused preview of what changed, what matters most, and the questions the patient wants answered.</p>

        <div class="appt-identity-grid">
          <div class="appt-card"><label>Patient</label><div class="appt-card-value">${esc(model.identity.name || 'Patient')}</div></div>
          <div class="appt-card"><label>Appointment date</label><div class="appt-card-value">${esc(appointmentPrep.appointmentDate)}</div></div>
          <div class="appt-card"><label>Clinician</label><div class="appt-card-value">${esc(appointmentPrep.clinicianName || 'Clinician not added')}</div></div>
          <div class="appt-card"><label>Report window</label><div class="appt-card-value">${esc(model.range.label)}</div></div>
        </div>
      </section>

      <section class="section appt-section">
        <h2>Snapshot for the visit</h2>
        <div class="appt-metrics-grid">
          <div class="appt-card"><label>Migraine days</label><div class="appt-metric-value">${esc(appointmentPrep.generatedSnapshot.currentSnapshot.headacheBurden.migraineDays)}</div><p class="appt-card-note">Recent monthly migraine burden</p></div>
          <div class="appt-card"><label>Headache days</label><div class="appt-metric-value">${esc(appointmentPrep.generatedSnapshot.currentSnapshot.headacheBurden.headacheDays)}</div><p class="appt-card-note">All headache days in the snapshot window</p></div>
          <div class="appt-card"><label>Acute medication days</label><div class="appt-metric-value">${esc(appointmentPrep.generatedSnapshot.currentSnapshot.acuteMedicationDays)}</div><p class="appt-card-note">Useful for discussing relief and overuse risk</p></div>
          <div class="appt-card"><label>Tracking quality</label><div class="appt-metric-value">${esc(model.dataQuality.trackedPct)}%</div><p class="appt-card-note">${esc(trackingLine)}</p></div>
        </div>
      </section>

      <section class="section appt-section">
        <div class="appt-detail-grid">
          <article class="appt-card">
            <h3>Why I&apos;m going</h3>
            <p class="appt-card-note">The patient&apos;s reason for the visit, in their own words, plus the top concerns they want the clinician to hear first.</p>
            ${appointmentPrep.visitReason ? `<p>${esc(appointmentPrep.visitReason)}</p>` : '<p class="appt-empty">No visit reason was added yet.</p>'}
            ${bulletList(appointmentPrep.topConcerns, 'No top concerns were added yet.')}
          </article>

          <article class="appt-card">
            <h3>Questions for my clinician</h3>
            <p class="appt-card-note">A short checklist of questions the patient wants to cover before the visit ends.</p>
            ${bulletList(appointmentPrep.doctorQuestions, 'No questions were added yet.')}
          </article>

          <article class="appt-card">
            <h3>What changed recently</h3>
            <p class="appt-card-note">Generated summary points from the current appointment-prep snapshot.</p>
            ${explanationList(recentChangeExplanations, 'No generated change summary was available for this visit.')}
          </article>

          <article class="appt-card">
            <h3>Supporting notes</h3>
            <p class="appt-card-note">Extra context that can help the clinician connect recent burden, tracking quality, and treatment questions.</p>
            <p><strong>Preventives:</strong> ${esc(preventiveLine)}</p>
            <p><strong>Questionnaires:</strong> ${esc(questionScores.join(' | ') || 'No recent questionnaire scores')}</p>
            <p><strong>Personal notes:</strong> ${esc(appointmentPrep.personalNotes || 'No personal notes were added for this visit.')}</p>
          </article>

          <article class="appt-card">
            <h3>Generated discussion prompts</h3>
            <p class="appt-card-note">Discussion cues pulled from the same appointment-prep snapshot so the preview matches the PDF more closely.</p>
            ${explanationList(questionPromptExplanations, 'No generated discussion prompts were available for this visit.')}
          </article>
        </div>
      </section>
    `);
  } else {
    if (show('cover')) {
      parts.push(section('Cover', `
        <p><strong>${esc(model.title)}</strong></p>
        <p>Range: ${esc(model.range.label)}</p>
        <p>Generated on ${esc(generatedOn)} (${esc(model.timezone)})</p>
      `));
    }

    if (show('summary')) {
      parts.push(section('Summary', `
        <div class="grid">
          <div><label>Tracked days quality</label><div>${esc(model.dataQuality.qualityLine)}</div></div>
          <div><label>MMD</label><div>${esc(model.outcomes.mmd)}</div></div>
          <div><label>MHD</label><div>${esc(model.outcomes.mhd)}</div></div>
          <div><label>Acute medication days</label><div>${esc(model.outcomes.acuteMedicationDays)}</div></div>
        </div>
        <p><strong>${esc(model.moh.title)}:</strong> ${esc(model.moh.text)}</p>
        <div class="grid">
          <div><label>HIT-6</label><div>${esc(model.questionnaires.hit6.score ?? 'N/A')}</div></div>
          <div><label>MIDAS</label><div>${esc(model.questionnaires.midas.score ?? 'N/A')}</div></div>
          <div><label>MSQ</label><div>${esc(model.questionnaires.msq.score ?? 'N/A')}</div></div>
        </div>
        <p><strong>Current preventives:</strong> ${esc(model.medications.currentPreventives.join(', ') || 'None')}</p>
        <p><strong>Top acute meds:</strong> ${esc(model.medications.topAcuteMeds.map(v => `${v.name} (${v.usageDays}d)`).join(', ') || 'None')}</p>
      `));
    }

    if (show('trends')) {
      parts.push(section('Trends', `
        <table>
          <thead><tr><th>Week start</th><th>Attack starts</th></tr></thead>
          <tbody>
            ${model.trends.weeklyAttackStarts.map(row => `<tr><td>${esc(row.weekStart)}</td><td>${esc(row.count)}</td></tr>`).join('')}
          </tbody>
        </table>
      `));
    }

    if (show('attacks')) {
      const tableBlocks = model.attacks.pages.length > 0
        ? model.attacks.pages.map((page, idx) => `
          <h3>Attacks table page ${idx + 1}</h3>
          <table>
            <thead>
              <tr><th>Date</th><th>Duration (h)</th><th>Severity</th><th>Symptoms</th><th>Acute meds</th><th>Impact</th></tr>
            </thead>
            <tbody>
              ${page.map(attack => `
                <tr>
                  <td>${esc(attack.date)}</td>
                  <td>${esc(attack.durationHours ?? 'N/A')}</td>
                  <td>${esc(attack.maxSeverity)}</td>
                  <td>${esc(attack.symptoms.join(', ') || 'None')}</td>
                  <td>${esc(attack.acuteMeds.join(', ') || 'None')}</td>
                  <td>${esc(attack.impact ?? 'N/A')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `).join('')
        : '<p>No attacks in selected range.</p>';

      parts.push(section('Attacks', tableBlocks));
    }

    if (show('medications')) {
      parts.push(section('Medications', `
        <p><strong>Current preventive medications</strong></p>
        <ul>${model.medications.currentPreventives.map(item => `<li>${esc(item)}</li>`).join('') || '<li>None</li>'}</ul>
        <p><strong>Top acute medications by usage days</strong></p>
        <ul>${model.medications.topAcuteMeds.map(item => `<li>${esc(item.name)} - ${esc(item.usageDays)} days</li>`).join('') || '<li>None</li>'}</ul>
      `));
    }

    if (show('diary')) {
      parts.push(section('Diary', `
        <table>
          <thead><tr><th>Date</th><th>Day type</th><th>Impact</th></tr></thead>
          <tbody>
            ${model.diary.days.slice(-90).map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.dayType)}</td><td>${esc(row.impact ?? 'N/A')}</td></tr>`).join('')}
          </tbody>
        </table>
      `));
    }

    if (show('insights')) {
      parts.push(section('Conservative insights', `
        <ul>
          <li>${esc(model.dataQuality.qualityLine)}</li>
          <li>MOH guardrail: ${esc(model.moh.status.toUpperCase())}</li>
          <li>Acute medication days: ${esc(model.outcomes.acuteMedicationDays)}</li>
        </ul>
      `));
    }

    if (show('cycle_hormones') && model.cycleHormones) {
      parts.push(section('Cycle & hormones', `
        <p>
          ${esc(model.cycleHormones.attacksInWindow)} of ${esc(model.cycleHormones.totalAttacks)}
          migraine attacks occurred in ${esc(model.cycleHormones.windowStart)}..${esc(model.cycleHormones.windowEnd)}
          days from bleed start.
        </p>
        ${model.cycleHormones.hormoneProfile ? `<p><strong>Hormone profile:</strong> ${esc(model.cycleHormones.hormoneProfile)}</p>` : ''}
        <h3>Relative-day attack frequency</h3>
        <table>
          <thead><tr><th>Relative day</th><th>Count</th></tr></thead>
          <tbody>
            ${model.cycleHormones.histogram.map(row => `<tr><td>${esc(row.relativeDay)}</td><td>${esc(row.count)}</td></tr>`).join('')}
          </tbody>
        </table>
        <h3>Last 90 days timeline</h3>
        <table>
          <thead><tr><th>Date</th><th>Bleeding</th><th>Migraine</th></tr></thead>
          <tbody>
            ${model.cycleHormones.timeline.slice(-90).map(row => `<tr><td>${esc(row.date)}</td><td>${row.bleeding ? 'Yes' : 'No'}</td><td>${row.migraine ? 'Yes' : 'No'}</td></tr>`).join('')}
          </tbody>
        </table>
      `));
    }
  }

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(model.title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 0; }
      .wrap { max-width: 900px; margin: 0 auto; padding: 16px; }
      .section { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 12px; break-inside: avoid; }
      h1, h2, h3 { margin: 0 0 8px; }
      h1 { font-size: 20px; }
      h2 { font-size: 16px; }
      h3 { font-size: 14px; margin-top: 10px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 8px 0; }
      label { color: #666; font-size: 11px; display: block; }
      .footer { margin-top: 12px; font-size: 11px; color: #666; }
      .appt-hero { background: linear-gradient(180deg, #fff7ef 0%, #fffdfb 100%); border-color: #f2d4bc; }
      .appt-pill { display: inline-block; margin-bottom: 8px; padding: 4px 10px; border-radius: 999px; background: #fde7d6; color: #8a4b21; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .appt-kicker { margin: 0 0 4px; color: #8a4b21; font-size: 12px; font-weight: 600; }
      .appt-title { font-size: 24px; margin-bottom: 6px; }
      .appt-subtitle { margin: 0 0 12px; color: #5f4b3f; line-height: 1.5; }
      .appt-section { background: #fffdfa; border-color: #ecd9ca; }
      .appt-identity-grid, .appt-metrics-grid, .appt-detail-grid { display: grid; gap: 10px; }
      .appt-identity-grid, .appt-metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .appt-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .appt-card { border: 1px solid #eddccc; border-radius: 12px; background: #ffffff; padding: 12px; box-shadow: 0 1px 0 rgba(140, 98, 65, 0.04); }
      .appt-card-value, .appt-metric-value { font-size: 18px; font-weight: 700; color: #1f2937; }
      .appt-metric-value { font-size: 24px; margin: 4px 0; }
      .appt-card-note { margin: 0; color: #6b5b50; font-size: 12px; line-height: 1.45; }
      .appt-list { margin: 8px 0 0 18px; padding: 0; }
      .appt-list li { margin-bottom: 6px; }
      .appt-empty { color: #6b7280; }
      @media (max-width: 640px) {
        .appt-identity-grid, .appt-metrics-grid, .appt-detail-grid, .grid { grid-template-columns: 1fr; }
      }
      @media print {
        .section { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>${esc(model.title)}</h1>
      <p>Range: ${esc(model.range.label)}</p>
      ${model.identity.name ? `<p>Patient: ${esc(model.identity.name)}</p>` : ''}
      ${parts.join('')}
      <div class="footer">
        Generated on ${esc(generatedOn)} (${esc(model.timezone)}).<br/>
        ${model.disclaimers.map(esc).join('<br/>')}
      </div>
    </div>
  </body>
</html>
`;
}
