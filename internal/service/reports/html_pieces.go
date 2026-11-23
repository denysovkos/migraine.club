// The static pieces of the clinician report template, byte for byte as the
// original renderHtml.ts template literals had them (whitespace included).

package reports

// appt expressions, in order:
//
//	esc(visitLabel)
//	esc(model.identity.name || 'Patient')
//	esc(appointmentPrep.appointmentDate)
//	esc(appointmentPrep.clinicianName || 'Clinician not added')
//	esc(model.range.label)
//	esc(appointmentPrep.generatedSnapshot.currentSnapshot.headacheBurden.migraineDays)
//	esc(appointmentPrep.generatedSnapshot.currentSnapshot.headacheBurden.headacheDays)
//	esc(appointmentPrep.generatedSnapshot.currentSnapshot.acuteMedicationDays)
//	esc(model.dataQuality.trackedPct)
//	esc(trackingLine)
//	appointmentPrep.visitReason ? `<p>${esc(appointmentPrep.visitReason)}</p>` : '<p class="appt-empty">No visit reason was added yet.</p>'
//	bulletList(appointmentPrep.topConcerns, 'No top concerns were added yet.')
//	bulletList(appointmentPrep.doctorQuestions, 'No questions were added yet.')
//	explanationList(recentChangeExplanations, 'No generated change summary was available for this visit.')
//	esc(preventiveLine)
//	esc(questionScores.join(' | ') || 'No recent questionnaire scores')
//	esc(appointmentPrep.personalNotes || 'No personal notes were added for this visit.')
//	explanationList(questionPromptExplanations, 'No generated discussion prompts were available for this visit.')
var apptPieces = []string{
	"\n      <section class=\"section appt-hero\">\n        <div class=\"appt-pill\">Appointment prep</div>\n        <p class=\"appt-kicker\">Warm-clinical visit summary</p>\n        <h2 class=\"appt-title\">",
	"</h2>\n        <p class=\"appt-subtitle\">A focused preview of what changed, what matters most, and the questions the patient wants answered.</p>\n\n        <div class=\"appt-identity-grid\">\n          <div class=\"appt-card\"><label>Patient</label><div class=\"appt-card-value\">",
	"</div></div>\n          <div class=\"appt-card\"><label>Appointment date</label><div class=\"appt-card-value\">",
	"</div></div>\n          <div class=\"appt-card\"><label>Clinician</label><div class=\"appt-card-value\">",
	"</div></div>\n          <div class=\"appt-card\"><label>Report window</label><div class=\"appt-card-value\">",
	"</div></div>\n        </div>\n      </section>\n\n      <section class=\"section appt-section\">\n        <h2>Snapshot for the visit</h2>\n        <div class=\"appt-metrics-grid\">\n          <div class=\"appt-card\"><label>Migraine days</label><div class=\"appt-metric-value\">",
	"</div><p class=\"appt-card-note\">Recent monthly migraine burden</p></div>\n          <div class=\"appt-card\"><label>Headache days</label><div class=\"appt-metric-value\">",
	"</div><p class=\"appt-card-note\">All headache days in the snapshot window</p></div>\n          <div class=\"appt-card\"><label>Acute medication days</label><div class=\"appt-metric-value\">",
	"</div><p class=\"appt-card-note\">Useful for discussing relief and overuse risk</p></div>\n          <div class=\"appt-card\"><label>Tracking quality</label><div class=\"appt-metric-value\">",
	"%</div><p class=\"appt-card-note\">",
	"</p></div>\n        </div>\n      </section>\n\n      <section class=\"section appt-section\">\n        <div class=\"appt-detail-grid\">\n          <article class=\"appt-card\">\n            <h3>Why I&apos;m going</h3>\n            <p class=\"appt-card-note\">The patient&apos;s reason for the visit, in their own words, plus the top concerns they want the clinician to hear first.</p>\n            ",
	"\n            ",
	"\n          </article>\n\n          <article class=\"appt-card\">\n            <h3>Questions for my clinician</h3>\n            <p class=\"appt-card-note\">A short checklist of questions the patient wants to cover before the visit ends.</p>\n            ",
	"\n          </article>\n\n          <article class=\"appt-card\">\n            <h3>What changed recently</h3>\n            <p class=\"appt-card-note\">Generated summary points from the current appointment-prep snapshot.</p>\n            ",
	"\n          </article>\n\n          <article class=\"appt-card\">\n            <h3>Supporting notes</h3>\n            <p class=\"appt-card-note\">Extra context that can help the clinician connect recent burden, tracking quality, and treatment questions.</p>\n            <p><strong>Preventives:</strong> ",
	"</p>\n            <p><strong>Questionnaires:</strong> ",
	"</p>\n            <p><strong>Personal notes:</strong> ",
	"</p>\n          </article>\n\n          <article class=\"appt-card\">\n            <h3>Generated discussion prompts</h3>\n            <p class=\"appt-card-note\">Discussion cues pulled from the same appointment-prep snapshot so the preview matches the PDF more closely.</p>\n            ",
	"\n          </article>\n        </div>\n      </section>\n    ",
}

// cover expressions, in order:
//
//	esc(model.title)
//	esc(model.range.label)
//	esc(generatedOn)
//	esc(model.timezone)
var coverPieces = []string{
	"\n        <p><strong>",
	"</strong></p>\n        <p>Range: ",
	"</p>\n        <p>Generated on ",
	" (",
	")</p>\n      ",
}

// summary expressions, in order:
//
//	esc(model.dataQuality.qualityLine)
//	esc(model.outcomes.mmd)
//	esc(model.outcomes.mhd)
//	esc(model.outcomes.acuteMedicationDays)
//	esc(model.moh.title)
//	esc(model.moh.text)
//	esc(model.questionnaires.hit6.score ?? 'N/A')
//	esc(model.questionnaires.midas.score ?? 'N/A')
//	esc(model.questionnaires.msq.score ?? 'N/A')
//	esc(model.medications.currentPreventives.join(', ') || 'None')
//	esc(model.medications.topAcuteMeds.map(v => `${v.name} (${v.usageDays}d)`).join(', ') || 'None')
var summaryPieces = []string{
	"\n        <div class=\"grid\">\n          <div><label>Tracked days quality</label><div>",
	"</div></div>\n          <div><label>MMD</label><div>",
	"</div></div>\n          <div><label>MHD</label><div>",
	"</div></div>\n          <div><label>Acute medication days</label><div>",
	"</div></div>\n        </div>\n        <p><strong>",
	":</strong> ",
	"</p>\n        <div class=\"grid\">\n          <div><label>HIT-6</label><div>",
	"</div></div>\n          <div><label>MIDAS</label><div>",
	"</div></div>\n          <div><label>MSQ</label><div>",
	"</div></div>\n        </div>\n        <p><strong>Current preventives:</strong> ",
	"</p>\n        <p><strong>Top acute meds:</strong> ",
	"</p>\n      ",
}

// trends expressions, in order:
//
//	model.trends.weeklyAttackStarts.map(row => `<tr><td>${esc(row.weekStart)}</td><td>${esc(row.count)}</td></tr>`).join('')
var trendsPieces = []string{
	"\n        <table>\n          <thead><tr><th>Week start</th><th>Attack starts</th></tr></thead>\n          <tbody>\n            ",
	"\n          </tbody>\n        </table>\n      ",
}

// attackPage expressions, in order:
//
//	idx + 1
//	page.map(attack => ` <tr> <td>${esc(attack.date)}</td> <td>${esc(attack.durationHours ?? 'N/A')}</td> <td>${esc(attack.maxSeverity)}</td> <td>${esc(at
var attackPagePieces = []string{
	"\n          <h3>Attacks table page ",
	"</h3>\n          <table>\n            <thead>\n              <tr><th>Date</th><th>Duration (h)</th><th>Severity</th><th>Symptoms</th><th>Acute meds</th><th>Impact</th></tr>\n            </thead>\n            <tbody>\n              ",
	"\n            </tbody>\n          </table>\n        ",
}

// attackRow expressions, in order:
//
//	esc(attack.date)
//	esc(attack.durationHours ?? 'N/A')
//	esc(attack.maxSeverity)
//	esc(attack.symptoms.join(', ') || 'None')
//	esc(attack.acuteMeds.join(', ') || 'None')
//	esc(attack.impact ?? 'N/A')
var attackRowPieces = []string{
	"\n                <tr>\n                  <td>",
	"</td>\n                  <td>",
	"</td>\n                  <td>",
	"</td>\n                  <td>",
	"</td>\n                  <td>",
	"</td>\n                  <td>",
	"</td>\n                </tr>\n              ",
}

// medications expressions, in order:
//
//	model.medications.currentPreventives.map(item => `<li>${esc(item)}</li>`).join('') || '<li>None</li>'
//	model.medications.topAcuteMeds.map(item => `<li>${esc(item.name)} - ${esc(item.usageDays)} days</li>`).join('') || '<li>None</li>'
var medicationsPieces = []string{
	"\n        <p><strong>Current preventive medications</strong></p>\n        <ul>",
	"</ul>\n        <p><strong>Top acute medications by usage days</strong></p>\n        <ul>",
	"</ul>\n      ",
}

// diary expressions, in order:
//
//	model.diary.days.slice(-90).map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.dayType)}</td><td>${esc(row.impact ?? 'N/A')}</td></tr>`).join('')
var diaryPieces = []string{
	"\n        <table>\n          <thead><tr><th>Date</th><th>Day type</th><th>Impact</th></tr></thead>\n          <tbody>\n            ",
	"\n          </tbody>\n        </table>\n      ",
}

// insights expressions, in order:
//
//	esc(model.dataQuality.qualityLine)
//	esc(model.moh.status.toUpperCase())
//	esc(model.outcomes.acuteMedicationDays)
var insightsPieces = []string{
	"\n        <ul>\n          <li>",
	"</li>\n          <li>MOH guardrail: ",
	"</li>\n          <li>Acute medication days: ",
	"</li>\n        </ul>\n      ",
}

// cycle expressions, in order:
//
//	esc(model.cycleHormones.attacksInWindow)
//	esc(model.cycleHormones.totalAttacks)
//	esc(model.cycleHormones.windowStart)
//	esc(model.cycleHormones.windowEnd)
//	model.cycleHormones.hormoneProfile ? `<p><strong>Hormone profile:</strong> ${esc(model.cycleHormones.hormoneProfile)}</p>` : ''
//	model.cycleHormones.histogram.map(row => `<tr><td>${esc(row.relativeDay)}</td><td>${esc(row.count)}</td></tr>`).join('')
//	model.cycleHormones.timeline.slice(-90).map(row => `<tr><td>${esc(row.date)}</td><td>${row.bleeding ? 'Yes' : 'No'}</td><td>${row.migraine ? 'Yes' : '
var cyclePieces = []string{
	"\n        <p>\n          ",
	" of ",
	"\n          migraine attacks occurred in ",
	"..",
	"\n          days from bleed start.\n        </p>\n        ",
	"\n        <h3>Relative-day attack frequency</h3>\n        <table>\n          <thead><tr><th>Relative day</th><th>Count</th></tr></thead>\n          <tbody>\n            ",
	"\n          </tbody>\n        </table>\n        <h3>Last 90 days timeline</h3>\n        <table>\n          <thead><tr><th>Date</th><th>Bleeding</th><th>Migraine</th></tr></thead>\n          <tbody>\n            ",
	"\n          </tbody>\n        </table>\n      ",
}

// document expressions, in order:
//
//	esc(model.title)
//	esc(model.title)
//	esc(model.range.label)
//	model.identity.name ? `<p>Patient: ${esc(model.identity.name)}</p>` : ''
//	parts.join('')
//	esc(generatedOn)
//	esc(model.timezone)
//	model.disclaimers.map(esc).join('<br/>')
var documentPieces = []string{
	"\n<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <title>",
	"</title>\n    <style>\n      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 0; }\n      .wrap { max-width: 900px; margin: 0 auto; padding: 16px; }\n      .section { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 12px; break-inside: avoid; }\n      h1, h2, h3 { margin: 0 0 8px; }\n      h1 { font-size: 20px; }\n      h2 { font-size: 16px; }\n      h3 { font-size: 14px; margin-top: 10px; }\n      table { width: 100%; border-collapse: collapse; font-size: 12px; }\n      th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }\n      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 8px 0; }\n      label { color: #666; font-size: 11px; display: block; }\n      .footer { margin-top: 12px; font-size: 11px; color: #666; }\n      .appt-hero { background: linear-gradient(180deg, #fff7ef 0%, #fffdfb 100%); border-color: #f2d4bc; }\n      .appt-pill { display: inline-block; margin-bottom: 8px; padding: 4px 10px; border-radius: 999px; background: #fde7d6; color: #8a4b21; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }\n      .appt-kicker { margin: 0 0 4px; color: #8a4b21; font-size: 12px; font-weight: 600; }\n      .appt-title { font-size: 24px; margin-bottom: 6px; }\n      .appt-subtitle { margin: 0 0 12px; color: #5f4b3f; line-height: 1.5; }\n      .appt-section { background: #fffdfa; border-color: #ecd9ca; }\n      .appt-identity-grid, .appt-metrics-grid, .appt-detail-grid { display: grid; gap: 10px; }\n      .appt-identity-grid, .appt-metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n      .appt-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n      .appt-card { border: 1px solid #eddccc; border-radius: 12px; background: #ffffff; padding: 12px; box-shadow: 0 1px 0 rgba(140, 98, 65, 0.04); }\n      .appt-card-value, .appt-metric-value { font-size: 18px; font-weight: 700; color: #1f2937; }\n      .appt-metric-value { font-size: 24px; margin: 4px 0; }\n      .appt-card-note { margin: 0; color: #6b5b50; font-size: 12px; line-height: 1.45; }\n      .appt-list { margin: 8px 0 0 18px; padding: 0; }\n      .appt-list li { margin-bottom: 6px; }\n      .appt-empty { color: #6b7280; }\n      @media (max-width: 640px) {\n        .appt-identity-grid, .appt-metrics-grid, .appt-detail-grid, .grid { grid-template-columns: 1fr; }\n      }\n      @media print {\n        .section { page-break-inside: avoid; }\n      }\n    </style>\n  </head>\n  <body>\n    <div class=\"wrap\">\n      <h1>",
	"</h1>\n      <p>Range: ",
	"</p>\n      ",
	"\n      ",
	"\n      <div class=\"footer\">\n        Generated on ",
	" (",
	").<br/>\n        ",
	"\n      </div>\n    </div>\n  </body>\n</html>\n",
}
