package reports

import (
	"regexp"
	"strings"

	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// esc is renderHtml's esc for an already-stringified value.
func esc(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(s)
}

func escInt[T ~int | ~int32](v T) string { return esc(jsx.FormatNumber(float64(v))) }

func escOr[T ~int | ~int32](v *T, fallback string) string {
	if v == nil {
		return esc(fallback)
	}
	return escInt(*v)
}

func orString(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// fill interleaves a literal's static pieces with its expression values.
func fill(pieces []string, values ...string) string {
	var b strings.Builder
	for i, p := range pieces {
		b.WriteString(p)
		if i < len(values) {
			b.WriteString(values[i])
		}
	}
	return b.String()
}

func section(title, content string) string {
	return `<section class="section"><h2>` + esc(title) + `</h2>` + content + `</section>`
}

func bulletList(items []string, empty string) string {
	if len(items) == 0 {
		return `<p class="appt-empty">` + esc(empty) + `</p>`
	}
	var b strings.Builder
	for _, it := range items {
		b.WriteString(`<li>` + esc(it) + `</li>`)
	}
	return `<ul class="appt-list">` + b.String() + `</ul>`
}

type explanation struct{ title, body string }

func explanationList(items []explanation, empty string) string {
	if len(items) == 0 {
		return `<p class="appt-empty">` + esc(empty) + `</p>`
	}
	var b strings.Builder
	for _, it := range items {
		b.WriteString(`<li><strong>` + esc(it.title) + `:</strong> ` + esc(it.body) + `</li>`)
	}
	return `<ul class="appt-list">` + b.String() + `</ul>`
}

var wordStart = regexp.MustCompile(`\b\w`)

// formatKeyLabel is formatKeyLabel: underscores to spaces, words capitalized.
func formatKeyLabel(key string) string {
	return wordStart.ReplaceAllStringFunc(strings.ReplaceAll(key, "_", " "), strings.ToUpper)
}

func n(v int) string { return jsx.FormatNumber(float64(v)) }

func snapshotExplanation(key string, m *Model) explanation {
	if m.AppointmentPrep == nil || m.AppointmentPrep.RawSnapshot == nil {
		return explanation{formatKeyLabel(key), formatKeyLabel(key)}
	}
	s := m.AppointmentPrep.Snapshot
	switch key {
	case "coverage_summary":
		return explanation{"Coverage summary", "Recorded days: " + n(s.Coverage.RecordedDays) + "/" + n(s.Coverage.TotalDays) +
			" · Missing: " + n(s.Coverage.MissingDays) + " (missing is not counted as headache-free)."}
	case "attack_summary":
		avg := "Average attack intensity was not available in the snapshot."
		if s.AttackStats.AvgIntensity != nil {
			avg = "Average logged attack intensity was " + jsx.ToFixed(*s.AttackStats.AvgIntensity, 1) + "/10."
		}
		return explanation{"Attack summary", n(s.AttackStats.TotalAttacks) + " attacks logged in the last " +
			n(s.CompareWindowDays) + " days. " + avg}
	case "treatment_adjustment":
		return explanation{"Current preventive plan", "Review whether the current prevention plan matches a recent burden of " +
			n(s.CurrentSnapshot.HeadacheBurden.MigraineDays) + " migraine days and " + n(s.CurrentSnapshot.HeadacheBurden.HeadacheDays) + " headache days."}
	case "acute_medication_safety":
		return explanation{"Acute medication safety", "Acute medication was used on " + n(s.CurrentSnapshot.AcuteMedicationDays) +
			" days in this snapshot, which can help frame how often rescue treatment is needed."}
	}
	return explanation{formatKeyLabel(key), formatKeyLabel(key)}
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func num(f float64) string { return jsx.FormatNumber(f) }

// RenderHTML is renderClinicianReportHtml.
func RenderHTML(m *Model) string {
	gen, _ := jsontime.Parse(m.GeneratedAtISO)
	generatedOn := gen.UTC().Format("2006-01-02 15:04")
	show := func(id string) bool {
		for _, s := range m.Sections {
			if s == id {
				return true
			}
		}
		return false
	}
	var parts []string

	if ap := m.AppointmentPrep; ap != nil {
		snap := ap.Snapshot
		visitLabel := orString(str(ap.VisitLabel), "Upcoming appointment")
		preventiveLine := orString(strings.Join(snap.CurrentSnapshot.PreventiveNames, ", "), "None listed")
		trackingLine := n(snap.Coverage.RecordedDays) + "/" + n(snap.Coverage.TotalDays) + " days recorded"
		var changes, prompts []explanation
		for _, k := range snap.WhatChangedKeys {
			changes = append(changes, snapshotExplanation(k, m))
		}
		for _, k := range snap.QuestionPromptKeys {
			prompts = append(prompts, snapshotExplanation(k, m))
		}
		var scores []string
		if v := snap.CurrentSnapshot.QuestionnaireScores.Hit6; v != nil {
			scores = append(scores, "HIT-6 "+num(*v))
		}
		if v := snap.CurrentSnapshot.QuestionnaireScores.Midas; v != nil {
			scores = append(scores, "MIDAS "+num(*v))
		}
		reason := `<p class="appt-empty">No visit reason was added yet.</p>`
		if ap.VisitReason != nil && *ap.VisitReason != "" {
			reason = `<p>` + esc(*ap.VisitReason) + `</p>`
		}
		name := ""
		if m.Identity.Name != nil {
			name = *m.Identity.Name
		}
		parts = append(parts, fill(apptPieces,
			esc(visitLabel),
			esc(orString(name, "Patient")),
			esc(ap.AppointmentDate),
			esc(orString(str(ap.ClinicianName), "Clinician not added")),
			esc(m.Range.Label),
			esc(n(snap.CurrentSnapshot.HeadacheBurden.MigraineDays)),
			esc(n(snap.CurrentSnapshot.HeadacheBurden.HeadacheDays)),
			esc(n(snap.CurrentSnapshot.AcuteMedicationDays)),
			esc(n(m.DataQuality.TrackedPct)),
			esc(trackingLine),
			reason,
			bulletList(ap.TopConcerns, "No top concerns were added yet."),
			bulletList(ap.DoctorQuestions, "No questions were added yet."),
			explanationList(changes, "No generated change summary was available for this visit."),
			esc(preventiveLine),
			esc(orString(strings.Join(scores, " | "), "No recent questionnaire scores")),
			esc(orString(str(ap.PersonalNotes), "No personal notes were added for this visit.")),
			explanationList(prompts, "No generated discussion prompts were available for this visit."),
		))
	} else {
		if show("cover") {
			parts = append(parts, section("Cover", fill(coverPieces, esc(m.Title), esc(m.Range.Label), esc(generatedOn), esc(m.Timezone))))
		}
		if show("summary") {
			var top []string
			for _, v := range m.Medications.TopAcuteMeds {
				top = append(top, v.Name+" ("+n(v.UsageDays)+"d)")
			}
			parts = append(parts, section("Summary", fill(summaryPieces,
				esc(m.DataQuality.QualityLine), escInt(m.Outcomes.Mmd), escInt(m.Outcomes.Mhd), escInt(m.Outcomes.AcuteMedicationDays),
				esc(m.Moh.Title), esc(m.Moh.Text),
				escOr(m.Questionnaires.Hit6.Score, "N/A"), escOr(m.Questionnaires.Midas.Score, "N/A"), escOr(m.Questionnaires.Msq.Score, "N/A"),
				esc(orString(strings.Join(m.Medications.CurrentPreventives, ", "), "None")),
				esc(orString(strings.Join(top, ", "), "None")),
			)))
		}
		if show("trends") {
			var rows strings.Builder
			for _, r := range m.Trends.WeeklyAttackStarts {
				rows.WriteString(`<tr><td>` + esc(r.WeekStart) + `</td><td>` + escInt(r.Count) + `</td></tr>`)
			}
			parts = append(parts, section("Trends", fill(trendsPieces, rows.String())))
		}
		if show("attacks") {
			blocks := `<p>No attacks in selected range.</p>`
			if len(m.Attacks.Pages) > 0 {
				var b strings.Builder
				for idx, page := range m.Attacks.Pages {
					var rows strings.Builder
					for _, a := range page {
						dur := esc("N/A")
						if a.DurationHours != nil {
							dur = esc(num(*a.DurationHours))
						}
						rows.WriteString(fill(attackRowPieces, esc(a.Date), dur, escInt(a.MaxSeverity),
							esc(orString(strings.Join(a.Symptoms, ", "), "None")), esc(orString(strings.Join(a.AcuteMeds, ", "), "None")),
							escOr(a.Impact, "N/A")))
					}
					b.WriteString(fill(attackPagePieces, n(idx+1), rows.String()))
				}
				blocks = b.String()
			}
			parts = append(parts, section("Attacks", blocks))
		}
		if show("medications") {
			var prev, top strings.Builder
			for _, it := range m.Medications.CurrentPreventives {
				prev.WriteString(`<li>` + esc(it) + `</li>`)
			}
			for _, it := range m.Medications.TopAcuteMeds {
				top.WriteString(`<li>` + esc(it.Name) + ` - ` + escInt(it.UsageDays) + ` days</li>`)
			}
			parts = append(parts, section("Medications", fill(medicationsPieces,
				orString(prev.String(), `<li>None</li>`), orString(top.String(), `<li>None</li>`))))
		}
		if show("diary") {
			days := m.Diary.Days[max(0, len(m.Diary.Days)-90):]
			var rows strings.Builder
			for _, r := range days {
				rows.WriteString(`<tr><td>` + esc(r.Date) + `</td><td>` + esc(r.DayType) + `</td><td>` + escOr(r.Impact, "N/A") + `</td></tr>`)
			}
			parts = append(parts, section("Diary", fill(diaryPieces, rows.String())))
		}
		if show("insights") {
			parts = append(parts, section("Conservative insights", fill(insightsPieces,
				esc(m.DataQuality.QualityLine), esc(strings.ToUpper(m.Moh.Status)), escInt(m.Outcomes.AcuteMedicationDays))))
		}
		if ch := m.CycleHormones; show("cycle_hormones") && ch != nil {
			profile := ""
			if ch.HormoneProfile != nil && *ch.HormoneProfile != "" {
				profile = `<p><strong>Hormone profile:</strong> ` + esc(*ch.HormoneProfile) + `</p>`
			}
			var hist, timeline strings.Builder
			for _, h := range ch.Histogram {
				o := h.(interface{ Get(string) (any, bool) })
				day, _ := o.Get("relativeDay")
				count, _ := o.Get("count")
				hist.WriteString(`<tr><td>` + escInt(day.(int)) + `</td><td>` + escInt(count.(int)) + `</td></tr>`)
			}
			yesNo := func(b bool) string {
				if b {
					return "Yes"
				}
				return "No"
			}
			for _, d := range ch.Timeline[max(0, len(ch.Timeline)-90):] {
				timeline.WriteString(`<tr><td>` + esc(d.Date) + `</td><td>` + yesNo(d.Bleeding) + `</td><td>` + yesNo(d.Migraine) + `</td></tr>`)
			}
			parts = append(parts, section("Cycle & hormones", fill(cyclePieces,
				escInt(ch.AttacksInWindow), escInt(ch.TotalAttacks), escInt(ch.WindowStart), escInt(ch.WindowEnd),
				profile, hist.String(), timeline.String())))
		}
	}

	patient := ""
	if m.Identity.Name != nil && *m.Identity.Name != "" {
		patient = `<p>Patient: ` + esc(*m.Identity.Name) + `</p>`
	}
	disclaimers := make([]string, len(m.Disclaimers))
	for i, d := range m.Disclaimers {
		disclaimers[i] = esc(d)
	}
	return fill(documentPieces, esc(m.Title), esc(m.Title), esc(m.Range.Label), patient, strings.Join(parts, ""),
		esc(generatedOn), esc(m.Timezone), strings.Join(disclaimers, "<br/>"))
}
