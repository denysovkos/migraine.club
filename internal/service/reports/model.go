// Package reports is src/services/reports/clinician: the clinician report
// model and its HTML preview.
package reports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/service/cycle"
	"github.com/denysovkos/migraine.club/internal/service/outcomes"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

const attacksPageSize = 24

// SectionIDs is clinicianReportSectionIds.
var SectionIDs = []string{"cover", "summary", "trends", "attacks", "medications", "diary", "insights", "cycle_hormones"}

func sectionsSchema() *zod.ObjectSchema {
	fs := make([]zod.Field, len(SectionIDs))
	for i, id := range SectionIDs {
		fs[i] = zod.F(id, zod.Default(zod.Boolean(), id != "cycle_hormones"))
	}
	return zod.Object(fs...)
}

// ConfigSchema is clinicianReportConfigSchema.
var ConfigSchema = zod.SuperRefine(zod.Object(
	zod.F("template", zod.Default(zod.Enum("quick", "full", "custom"), "quick")),
	zod.F("rangePreset", zod.Default(zod.Enum("last30", "last90", "last180", "custom"), "last90")),
	zod.F("from", zod.Optional(zod.String().Regex(`^\d{4}-\d{2}-\d{2}$`))),
	zod.F("to", zod.Optional(zod.String().Regex(`^\d{4}-\d{2}-\d{2}$`))),
	zod.F("appointmentPrepId", zod.Optional(zod.String().GUID())),
	zod.F("sections", zod.Default(sectionsSchema(), map[string]any{
		"cover": true, "summary": true, "trends": true, "attacks": true, "medications": true, "diary": true,
		"insights": true, "cycle_hormones": false,
	})),
), func(v any, ctx *zod.Ctx) {
	m := v.(map[string]any)
	if m["rangePreset"] != "custom" {
		return
	}
	from, _ := m["from"].(string)
	to, _ := m["to"].(string)
	if from == "" || to == "" {
		ctx.Issue("code", "custom", "message", "Custom range requires from and to values.")
		return
	}
	if from > to {
		ctx.Issue("code", "custom", "message", "Custom range must have from <= to.")
	}
})

// Config is the parsed config.
type Config struct {
	Template, RangePreset, From, To, AppointmentPrepID string
	Sections                                           map[string]bool
	Raw                                                any // zod-ordered output, for the model JSON
}

// ParseConfig parses like clinicianReportConfigSchema.parse.
func ParseConfig(v any) (Config, error) {
	out, err := zod.Parse(ConfigSchema, v)
	if err != nil {
		return Config{}, err
	}
	m := out.(map[string]any)
	c := Config{Template: m["template"].(string), RangePreset: m["rangePreset"].(string), Sections: map[string]bool{},
		Raw: zod.Ordered(ConfigSchema, out)}
	c.From, _ = m["from"].(string)
	c.To, _ = m["to"].(string)
	c.AppointmentPrepID, _ = m["appointmentPrepId"].(string)
	for k, v := range m["sections"].(map[string]any) {
		c.Sections[k] = v.(bool)
	}
	return c, nil
}

// ErrInvalidRange is resolveClinicianReportRange's custom-range error.
var ErrInvalidRange = errors.New("Invalid custom date range.")

func resolveRange(c Config, loc *time.Location, now time.Time) (string, string, error) {
	if c.RangePreset == "custom" {
		from, ok1 := luxon.FromISO(c.From, loc, now)
		to, ok2 := luxon.FromISO(c.To, loc, now)
		if !ok1 || !ok2 || localdate.StartOfDay(from, loc).After(localdate.StartOfDay(to, loc)) {
			return "", "", ErrInvalidRange
		}
		return luxon.ISODate(from), luxon.ISODate(to), nil
	}
	days := 90
	switch c.RangePreset {
	case "last30":
		days = 30
	case "last180":
		days = 180
	}
	today := localdate.StartOfDay(now, loc)
	return ymd(today.AddDate(0, 0, -(days - 1))), ymd(today), nil
}

func resolveSections(c Config) []string {
	switch c.Template {
	case "quick":
		return []string{"summary"}
	case "full":
		return append([]string{}, SectionIDs...)
	}
	var out []string
	for _, id := range SectionIDs {
		if c.Sections[id] {
			out = append(out, id)
		}
	}
	return out
}

func ymd(t time.Time) string { return t.Format(localdate.Layout) }

var (
	unsafeChars = regexp.MustCompile(`[<>{}]`)
)

// SanitizeText is sanitizeReportText.
func SanitizeText(v *string, max int) string {
	if v == nil || *v == "" {
		return ""
	}
	s := jsx.Trim(jsx.CollapseSpace(unsafeChars.ReplaceAllString(*v, ""), " "))
	return jsx.Slice(s, 0, max)
}

func sanitizeArray(raw json.RawMessage, maxItems int) []string {
	var values []any
	if json.Unmarshal(raw, &values) != nil {
		return []string{}
	}
	out := []string{}
	for _, v := range values {
		if s, ok := v.(string); ok {
			if t := SanitizeText(&s, 80); t != "" {
				out = append(out, t)
			}
		}
	}
	return out[:min(len(out), maxItems)]
}

// Snapshot is AppointmentPrepSnapshot.
type Snapshot struct {
	CompareWindowDays int `json:"compareWindowDays"`
	Coverage          struct {
		TotalDays    int `json:"totalDays"`
		RecordedDays int `json:"recordedDays"`
		MissingDays  int `json:"missingDays"`
	} `json:"coverage"`
	AttackStats struct {
		TotalAttacks int      `json:"totalAttacks"`
		AvgIntensity *float64 `json:"avgIntensity"`
	} `json:"attackStats"`
	CurrentSnapshot struct {
		HeadacheBurden struct {
			MigraineDays int `json:"migraineDays"`
			HeadacheDays int `json:"headacheDays"`
		} `json:"headacheBurden"`
		AcuteMedicationDays int      `json:"acuteMedicationDays"`
		PreventiveNames     []string `json:"preventiveNames"`
		QuestionnaireScores struct {
			Hit6  *float64 `json:"hit6"`
			Midas *float64 `json:"midas"`
		} `json:"questionnaireScores"`
	} `json:"currentSnapshot"`
	WhatChangedKeys    []string `json:"whatChangedKeys"`
	QuestionPromptKeys []string `json:"questionPromptKeys"`
}

// AppointmentPrep is the model's appointmentPrep block.
type AppointmentPrep struct {
	AppointmentDate string          `json:"appointmentDate"`
	VisitLabel      *string         `json:"visitLabel"`
	ClinicianName   *string         `json:"clinicianName"`
	VisitReason     *string         `json:"visitReason"`
	TopConcerns     []string        `json:"topConcerns"`
	DoctorQuestions []string        `json:"doctorQuestions"`
	PersonalNotes   *string         `json:"personalNotes"`
	RawSnapshot     json.RawMessage `json:"generatedSnapshot"`
	Snapshot        Snapshot        `json:"-"`
}

// AttackRow is ClinicianAttackRow.
type AttackRow struct {
	Date          string   `json:"date"`
	DurationHours *float64 `json:"durationHours"`
	MaxSeverity   int32    `json:"maxSeverity"`
	Symptoms      []string `json:"symptoms"`
	AcuteMeds     []string `json:"acuteMeds"`
	Effectiveness *string  `json:"effectiveness"`
	Impact        *int32   `json:"impact"`
}

// Questionnaire is one questionnaires entry.
type Questionnaire struct {
	Score   *int32  `json:"score"`
	TakenAt *string `json:"takenAt"`
}

// Model is ClinicianReportModel.
type Model struct {
	Title           string           `json:"title"`
	GeneratedAtISO  string           `json:"generatedAtIso"`
	Timezone        string           `json:"timezone"`
	Config          any              `json:"config"`
	AppointmentPrep *AppointmentPrep `json:"appointmentPrep"`
	Range           struct {
		From  string `json:"from"`
		To    string `json:"to"`
		Label string `json:"label"`
	} `json:"range"`
	Sections []string `json:"sections"`
	Identity struct {
		Name *string `json:"name"`
	} `json:"identity"`
	DataQuality struct {
		TotalDays   int    `json:"totalDays"`
		TrackedDays int    `json:"trackedDays"`
		MissingDays int    `json:"missingDays"`
		TrackedPct  int    `json:"trackedPct"`
		QualityLine string `json:"qualityLine"`
	} `json:"dataQuality"`
	Outcomes struct {
		Mmd                 int `json:"mmd"`
		Mhd                 int `json:"mhd"`
		AcuteMedicationDays int `json:"acuteMedicationDays"`
	} `json:"outcomes"`
	Moh struct {
		Status string `json:"status"`
		Title  string `json:"title"`
		Text   string `json:"text"`
	} `json:"moh"`
	Questionnaires struct {
		Hit6  Questionnaire `json:"hit6"`
		Midas Questionnaire `json:"midas"`
		Msq   Questionnaire `json:"msq"`
	} `json:"questionnaires"`
	Medications struct {
		CurrentPreventives []string `json:"currentPreventives"`
		TopAcuteMeds       []MedUse `json:"topAcuteMeds"`
	} `json:"medications"`
	Trends struct {
		WeeklyAttackStarts []WeekCount `json:"weeklyAttackStarts"`
	} `json:"trends"`
	Attacks struct {
		Total    int           `json:"total"`
		PageSize int           `json:"pageSize"`
		Pages    [][]AttackRow `json:"pages"`
	} `json:"attacks"`
	Diary struct {
		Days []DiaryRow `json:"days"`
	} `json:"diary"`
	CycleHormones *CycleHormones `json:"cycleHormones"`
	Disclaimers   []string       `json:"disclaimers"`
}

// MedUse is a topAcuteMeds entry.
type MedUse struct {
	Name      string `json:"name"`
	UsageDays int    `json:"usageDays"`
}

// WeekCount is a weeklyAttackStarts entry.
type WeekCount struct {
	WeekStart string `json:"weekStart"`
	Count     int    `json:"count"`
}

// DiaryRow is a diary.days entry.
type DiaryRow struct {
	Date    string `json:"date"`
	DayType string `json:"dayType"`
	Impact  *int32 `json:"impact"`
}

// TimelineDay is a cycle timeline entry.
type TimelineDay struct {
	Date     string `json:"date"`
	Bleeding bool   `json:"bleeding"`
	Migraine bool   `json:"migraine"`
}

// CycleHormones is the model's cycleHormones block.
type CycleHormones struct {
	Timeline        []TimelineDay `json:"timeline"`
	AttacksInWindow int           `json:"attacksInWindow"`
	TotalAttacks    int           `json:"totalAttacks"`
	WindowStart     int32         `json:"windowStart"`
	WindowEnd       int32         `json:"windowEnd"`
	HormoneProfile  *string       `json:"hormoneProfile"`
	Histogram       []any         `json:"histogram"`
}

func mohGuardrail(days int) (string, string, string) {
	switch {
	case days >= 15:
		return "high", "Higher medication-overuse concern", "Acute medication use days are elevated in this period. This report is informational only; please review in clinical context."
	case days >= 10:
		return "watch", "Monitor medication-overuse risk", "Acute medication use days are moderately elevated. Trend over time may help clinical discussion."
	}
	return "low", "No conservative overuse signal", "Acute medication use is below conservative guardrail thresholds for this period."
}

func mondayOf(d time.Time) time.Time {
	wd := int(d.Weekday())
	if wd == 0 {
		wd = 7
	}
	return d.AddDate(0, 0, -(wd - 1))
}

func civil(s string) time.Time { t, _ := time.Parse(localdate.Layout, s); return t }

func firstName(ps ...*string) *string {
	for _, p := range ps {
		if p != nil {
			return p
		}
	}
	return nil
}

// Service builds report models.
type Service struct {
	Q   *q.Queries
	Now func() time.Time
}

// Build is getClinicianReportModel.
func (s *Service) Build(ctx context.Context, uid string, c Config) (*Model, error) {
	zone, err := usertz.Get(ctx, s.Q, uid)
	if err != nil {
		return nil, err
	}
	loc := tz.LoadOrUTC(zone)
	now := s.Now()
	from, to, err := resolveRange(c, loc, now)
	if err != nil {
		return nil, err
	}
	fromDay, _ := localdate.ParseInZone(from, loc)
	toDay, _ := localdate.ParseInZone(to, loc)
	endExcl := localdate.StartOfDay(toDay.AddDate(0, 0, 1), loc)
	totalDays := max(1, int(jsx.Round(luxon.DiffDays(toDay, loc, fromDay, loc)))+1)
	cycleTo := to
	cycleFrom := ymd(civil(to).AddDate(0, 0, -89))
	cycleFromDay, _ := localdate.ParseInZone(cycleFrom, loc)
	date := func(s string) jsontime.Date { return jsontime.NewDate(civil(s)) }

	episodes, err := s.Q.ReportEpisodes(ctx, uid, jsontime.New(fromDay), jsontime.New(endExcl))
	if err != nil {
		return nil, err
	}
	diaryRows, err := s.Q.ReportDiaryRows(ctx, uid, date(from), date(to))
	if err != nil {
		return nil, err
	}
	intakes, err := s.Q.ReportIntakes(ctx, uid, jsontime.New(fromDay), jsontime.New(endExcl))
	if err != nil {
		return nil, err
	}
	preventives, err := s.Q.ReportPreventives(ctx, uid, jsontime.New(endExcl))
	if err != nil {
		return nil, err
	}
	quests, err := s.Q.ReportQuestionnaires(ctx, uid)
	if err != nil {
		return nil, err
	}
	var displayName *string
	if name, err := s.Q.ReportUserName(ctx, uid); err == nil {
		displayName = &name
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	totals, err := (&outcomes.Service{Q: s.Q, Now: s.Now}).RangeTotals(ctx, uid, zone, from, to, totalDays)
	if err != nil {
		return nil, err
	}
	cycleSettings, err := s.Q.GetCycleSettings(ctx, uid)
	hasCycle := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	bleedRows, err := s.Q.ReportBleedingRows(ctx, uid, date(cycleFrom), date(cycleTo))
	if err != nil {
		return nil, err
	}
	migraineRows, err := s.Q.ReportMigraineDays(ctx, uid, date(cycleFrom), date(cycleTo))
	if err != nil {
		return nil, err
	}
	cycleAttacks, err := s.Q.ReportCycleAttacks(ctx, uid, jsontime.New(cycleFromDay), jsontime.New(endExcl))
	if err != nil {
		return nil, err
	}
	var prep *q.AppointmentPrep
	if c.AppointmentPrepID != "" {
		r, err := s.Q.GetAppointmentPrep(ctx, uid, c.AppointmentPrepID)
		switch {
		case err == nil:
			prep = &r
		case !errors.Is(err, pgx.ErrNoRows):
			return nil, err
		}
	}

	type diaryVal struct {
		dayType string
		impact  *int32
	}
	diaryByDate := map[string]diaryVal{}
	var diaryOrder []string
	for _, r := range diaryRows {
		d := r.LocalDate.YMD()
		if _, ok := diaryByDate[d]; !ok {
			diaryOrder = append(diaryOrder, d)
		}
		diaryByDate[d] = diaryVal{r.DayType, r.Impact}
	}

	medsByEpisode := map[int32][]string{}
	usage := map[string]map[string]bool{}
	var usageOrder []string
	for _, m := range intakes {
		name := SanitizeText(firstName(m.MedicationName, m.CustomName, m.CanonicalName), 80)
		if name == "" {
			continue
		}
		if _, ok := usage[name]; !ok {
			usage[name] = map[string]bool{}
			usageOrder = append(usageOrder, name)
		}
		usage[name][localdate.String(m.TakenAt.Time, zone)] = true
		if m.EpisodeID != nil {
			medsByEpisode[*m.EpisodeID] = append(medsByEpisode[*m.EpisodeID], name)
		}
	}

	rows := make([]AttackRow, 0, len(episodes))
	for _, ep := range episodes {
		d := localdate.String(ep.StartTime.Time, zone)
		row := AttackRow{Date: d, MaxSeverity: ep.Intensity, Symptoms: sanitizeArray(ep.Symptoms, 6)}
		if ep.EndTime != nil {
			hours := float64(ep.EndTime.UnixMilli()-ep.StartTime.UnixMilli()) / 3600000
			v := jsx.StringToNumber(jsx.ToFixed(hours, 1))
			if !math.IsNaN(v) && !math.IsInf(v, 0) {
				row.DurationHours = &v
			}
		}
		var fromEpisode []string
		var entries []map[string]any
		_ = json.Unmarshal(ep.Medications, &entries)
		for _, e := range entries {
			name, _ := e["name"].(string)
			if t := SanitizeText(&name, 80); t != "" {
				fromEpisode = append(fromEpisode, t)
			}
		}
		meds := []string{}
		for _, n := range append(fromEpisode, medsByEpisode[ep.ID]...) {
			if !slices.Contains(meds, n) {
				meds = append(meds, n)
			}
		}
		row.AcuteMeds = meds[:min(len(meds), 6)]
		if v, ok := diaryByDate[d]; ok {
			row.Impact = v.impact
		}
		rows = append(rows, row)
	}

	m := &Model{Title: "Migrennity Clinician Report", GeneratedAtISO: jsontime.Format(now), Timezone: zone, Config: c.Raw}
	m.Range.From, m.Range.To, m.Range.Label = from, to, from+" to "+to
	m.Identity.Name = nil
	if n := SanitizeText(displayName, 80); n != "" {
		m.Identity.Name = &n
	}
	tracked := totals.Coverage.RecordedDays
	pct := int(jsx.Round(float64(tracked) / float64(max(1, totals.Coverage.TotalDays)) * 100))
	m.DataQuality.TotalDays, m.DataQuality.TrackedDays, m.DataQuality.MissingDays = totals.Coverage.TotalDays, tracked, totals.Coverage.MissingDays
	m.DataQuality.TrackedPct = pct
	m.DataQuality.QualityLine = fmt.Sprintf("%d/%d tracked days (%d%%)", tracked, totals.Coverage.TotalDays, pct)
	m.Outcomes.Mmd, m.Outcomes.Mhd, m.Outcomes.AcuteMedicationDays = totals.MmdMin, totals.MhdMin, totals.AcuteMedicationDays
	m.Moh.Status, m.Moh.Title, m.Moh.Text = mohGuardrail(totals.AcuteMedicationDays)

	pick := func(kind string) Questionnaire {
		for _, r := range quests {
			if r.Type == kind {
				t := jsontime.Format(r.TakenAt.Time)
				return Questionnaire{Score: r.ScoreTotal, TakenAt: &t}
			}
		}
		return Questionnaire{}
	}
	m.Questionnaires.Hit6, m.Questionnaires.Midas, m.Questionnaires.Msq = pick("HIT6"), pick("MIDAS"), pick("MSQ21")

	top := make([]MedUse, 0, len(usageOrder))
	for _, n := range usageOrder {
		top = append(top, MedUse{n, len(usage[n])})
	}
	sort.SliceStable(top, func(i, j int) bool {
		if top[i].UsageDays != top[j].UsageDays {
			return top[i].UsageDays > top[j].UsageDays
		}
		return jsx.LocaleCompare(top[i].Name, top[j].Name) < 0
	})
	m.Medications.TopAcuteMeds = top[:min(len(top), 8)]
	m.Medications.CurrentPreventives = []string{}
	for _, p := range preventives {
		if p.Status == "active" || p.Status == "paused" {
			if n := SanitizeText(&p.Name, 80); n != "" {
				m.Medications.CurrentPreventives = append(m.Medications.CurrentPreventives, n)
			}
		}
	}
	m.Medications.CurrentPreventives = m.Medications.CurrentPreventives[:min(len(m.Medications.CurrentPreventives), 12)]

	// Weekly attack starts: every week from the start week to the end week.
	counts := map[string]int{}
	var weeks []string
	for cur, end := mondayOf(civil(from)), mondayOf(civil(to)); !cur.After(end); cur = cur.AddDate(0, 0, 7) {
		counts[ymd(cur)] = 0
		weeks = append(weeks, ymd(cur))
	}
	for _, r := range rows {
		k := ymd(mondayOf(civil(r.Date)))
		if _, ok := counts[k]; !ok {
			weeks = append(weeks, k)
		}
		counts[k]++
	}
	sort.Strings(weeks)
	m.Trends.WeeklyAttackStarts = []WeekCount{}
	for _, w := range weeks {
		m.Trends.WeeklyAttackStarts = append(m.Trends.WeeklyAttackStarts, WeekCount{w, counts[w]})
	}

	m.Attacks.Total, m.Attacks.PageSize, m.Attacks.Pages = len(rows), attacksPageSize, [][]AttackRow{}
	for i := 0; i < len(rows); i += attacksPageSize {
		m.Attacks.Pages = append(m.Attacks.Pages, rows[i:min(len(rows), i+attacksPageSize)])
	}
	sort.Strings(diaryOrder)
	m.Diary.Days = []DiaryRow{}
	for _, d := range diaryOrder {
		m.Diary.Days = append(m.Diary.Days, DiaryRow{d, diaryByDate[d].dayType, diaryByDate[d].impact})
	}

	cycleExport := hasCycle && cycleSettings.Enabled && cycleSettings.IncludeInExports
	if cycleExport {
		bleeding := map[string]bool{}
		for _, r := range bleedRows {
			if r.Bleeding {
				bleeding[r.LocalDate.YMD()] = true
			}
		}
		migraine := map[string]bool{}
		for _, d := range migraineRows {
			migraine[d.YMD()] = true
		}
		starts := cycle.BleedingStartDates(bleeding)
		var attackDates []string
		for _, a := range cycleAttacks {
			if a.AttackType == "migraine" {
				attackDates = append(attackDates, localdate.String(a.StartTime.Time, zone))
			}
		}
		sort.Strings(attackDates)
		ws, we := cycleSettings.PerimenstrualWindowStartDays, cycleSettings.PerimenstrualWindowEndDays
		in := 0
		for _, d := range attackDates {
			if cycle.InWindow(d, cycle.NearestStart(d, starts), int(ws), int(we)) {
				in++
			}
		}
		ch := &CycleHormones{AttacksInWindow: in, TotalAttacks: len(attackDates), WindowStart: ws, WindowEnd: we,
			Histogram: cycle.Histogram(attackDates, starts, -5, 7)}
		for cur, end := civil(cycleFrom), civil(cycleTo); !cur.After(end); cur = cur.AddDate(0, 0, 1) {
			d := ymd(cur)
			ch.Timeline = append(ch.Timeline, TimelineDay{d, bleeding[d], migraine[d]})
		}
		if p := cycleSettings.HormoneProfile; p != "unknown" && p != "prefer_not_to_say" {
			ch.HormoneProfile = &p
		}
		m.CycleHormones = ch
	}

	if prep != nil {
		ap := &AppointmentPrep{AppointmentDate: prep.AppointmentDate.YMD(), RawSnapshot: prep.GeneratedSnapshot}
		opt := func(p *string, max int) *string {
			if t := SanitizeText(p, max); t != "" {
				return &t
			}
			return nil
		}
		ap.VisitLabel, ap.ClinicianName, ap.VisitReason = opt(prep.VisitLabel, 120), opt(prep.ClinicianName, 120), opt(prep.VisitReason, 500)
		ap.PersonalNotes = opt(prep.PersonalNotes, 1000)
		ap.TopConcerns, ap.DoctorQuestions = sanitizeArray(prep.TopConcerns, 8), sanitizeArray(prep.DoctorQuestions, 8)
		_ = json.Unmarshal(prep.GeneratedSnapshot, &ap.Snapshot)
		m.AppointmentPrep = ap
	}

	for _, sec := range resolveSections(c) {
		if cycleExport || sec != "cycle_hormones" {
			m.Sections = append(m.Sections, sec)
		}
	}
	if m.Sections == nil {
		m.Sections = []string{}
	}
	m.Disclaimers = []string{
		"This report is informational only and is not a diagnosis.",
		"Please discuss all treatment decisions with a licensed clinician.",
	}
	return m, nil
}
