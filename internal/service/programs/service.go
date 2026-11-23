package programs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	programcontent "github.com/denysovkos/migraine.club/content/programs"
	"github.com/denysovkos/migraine.club/internal/db"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/service/intake"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

// Definition is a ProgramDefinition. Frontmatter values keep the file's key
// order, which is the frontmatter schema's (checked by definitions_test.go).
type Definition struct {
	ID            string
	Title         string
	Shape         string
	DurationWeeks int
	DefaultTarget json.RawMessage
	Citations     []json.RawMessage
	Disclaimer    string
	Triggers      []Trigger
	Body          string
	bodies        map[string]string
}

// Trigger is a RecommendationTrigger.
type Trigger struct {
	Kind                  string   `json:"kind"`
	Factor                string   `json:"factor"`
	Field                 string   `json:"field"`
	Values                []string `json:"values"`
	MinDays               int      `json:"minDays"`
	MinHeadacheDays       int      `json:"minHeadacheDays"`
	AverageMinutesAtLeast float64  `json:"averageMinutesAtLeast"`
	WindowDays            int      `json:"windowDays"`
}

var definitions = mustLoad()

func mustLoad() []Definition {
	entries, err := programcontent.FS.ReadDir(".")
	if err != nil {
		panic(err)
	}
	var defs []Definition
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		slug := strings.TrimSuffix(name, ".json")
		raw, _ := programcontent.FS.ReadFile(name)
		var fm struct {
			ID                     string            `json:"id"`
			Title                  string            `json:"title"`
			Shape                  string            `json:"shape"`
			DurationWeeks          int               `json:"durationWeeks"`
			DefaultTarget          json.RawMessage   `json:"defaultTarget"`
			RecommendationTriggers []Trigger         `json:"recommendationTriggers"`
			Citations              []json.RawMessage `json:"citations"`
			Disclaimer             string            `json:"disclaimer"`
		}
		if err := json.Unmarshal(raw, &fm); err != nil {
			panic(fmt.Sprintf("Invalid frontmatter in %s: %v", name, err))
		}
		body, err := programcontent.FS.ReadFile(slug + ".md")
		if err != nil {
			panic(err)
		}
		d := Definition{ID: fm.ID, Title: fm.Title, Shape: fm.Shape, DurationWeeks: fm.DurationWeeks,
			DefaultTarget: compact(fm.DefaultTarget), Disclaimer: fm.Disclaimer, Triggers: fm.RecommendationTriggers,
			Body: jsx.Trim(string(body)), bodies: map[string]string{}}
		for _, c := range fm.Citations {
			d.Citations = append(d.Citations, compact(c))
		}
		for _, loc := range []string{"fr", "uk"} {
			if b, err := programcontent.FS.ReadFile(slug + "." + loc + ".md"); err == nil {
				d.bodies[loc] = jsx.Trim(string(b))
			}
		}
		defs = append(defs, d)
	}
	// localeCompare on lowercase-kebab ids orders like byte comparison.
	sort.Slice(defs, func(i, j int) bool { return defs[i].ID < defs[j].ID })
	return defs
}

func compact(raw json.RawMessage) json.RawMessage {
	var b bytes.Buffer
	if err := json.Compact(&b, raw); err != nil {
		panic(err)
	}
	return b.Bytes()
}

// Definitions is getProgramDefinitions.
func Definitions() []Definition { return definitions }

// Lookup is getProgramDefinition.
func Lookup(id string) *Definition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}

// BodyFor is getProgramBody: the locale's body, else English.
func (d *Definition) BodyFor(locale string) string {
	if b, ok := d.bodies[locale]; ok {
		return b
	}
	return d.Body
}

// Service holds the programs module's database operations.
type Service struct {
	Q   *q.Queries
	Now func() time.Time
}

// Settings is ProgramSettingsDTO.
type Settings struct {
	Enabled             bool
	NotificationsConfig json.RawMessage
	UpdatedAt           *time.Time
}

// JSON is the settings body.
func (s Settings) JSON() *httpx.Object {
	var updated any
	if s.UpdatedAt != nil {
		updated = jsontime.Format(*s.UpdatedAt)
	}
	return httpx.O("enabled", s.Enabled, "notificationsConfig", s.NotificationsConfig, "updatedAt", updated)
}

// GetSettings is programSettingsService.get.
func (s *Service) GetSettings(ctx context.Context, uid string) (Settings, error) {
	row, err := s.Q.GetProgramSettings(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{NotificationsConfig: json.RawMessage("{}")}, nil
	}
	if err != nil {
		return Settings{}, err
	}
	cfg := row.NotificationsConfig
	if len(cfg) == 0 || string(cfg) == "null" {
		cfg = json.RawMessage("{}")
	}
	t := row.UpdatedAt.Time
	return Settings{Enabled: row.Enabled, NotificationsConfig: cfg, UpdatedAt: &t}, nil
}

// UpdateSettings is programSettingsService.update. patch is the parsed body.
func (s *Service) UpdateSettings(ctx context.Context, uid string, patch map[string]any) (Settings, error) {
	cur, err := s.GetSettings(ctx, uid)
	if err != nil {
		return Settings{}, err
	}
	enabled := cur.Enabled
	if v, ok := patch["enabled"].(bool); ok {
		enabled = v
	}
	merged := map[string]any{}
	if err := json.Unmarshal(cur.NotificationsConfig, &merged); err != nil || merged == nil {
		merged = map[string]any{}
	}
	if nc, ok := patch["notificationsConfig"].(map[string]any); ok {
		for k, v := range nc {
			merged[k] = v
		}
	}
	cfg, _ := httpx.Marshal(merged)
	if err := s.Q.UpsertProgramSettings(ctx, uid, enabled, cfg, jsontime.New(s.Now())); err != nil {
		return Settings{}, err
	}
	return s.GetSettings(ctx, uid)
}

// EnrollmentJSON is rowToDto.
func EnrollmentJSON(r q.ProgramEnrollment) *httpx.Object {
	var end any
	if r.EndDate != nil {
		end = string(*r.EndDate)
	}
	return httpx.O("id", r.ID, "userId", r.UserID, "programId", r.ProgramID, "status", r.Status,
		"targetPayload", r.TargetPayload, "startDate", string(r.StartDate), "endDate", end,
		"baselineWindowStart", string(r.BaselineWindowStart), "baselineWindowEnd", string(r.BaselineWindowEnd),
		"evaluationWindowStart", string(r.EvaluationWindowStart), "evaluationWindowEnd", string(r.EvaluationWindowEnd),
		"rampDays", r.RampDays, "timezone", r.Timezone)
}

// Active is programEnrollmentService.getActive; nil when none.
func (s *Service) Active(ctx context.Context, uid, programID string) (*q.ProgramEnrollment, error) {
	r, err := s.Q.ActiveEnrollment(ctx, uid, programID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// List is listForUser.
func (s *Service) List(ctx context.Context, uid string) ([]q.ProgramEnrollment, error) {
	return s.Q.ListEnrollments(ctx, uid)
}

func ymdPlus(ymd string, n int) string {
	t, _ := time.Parse(localdate.Layout, ymd)
	return t.AddDate(0, 0, n).Format(localdate.Layout)
}

// Enroll is programEnrollmentService.enroll.
func (s *Service) Enroll(ctx context.Context, uid, programID string, target any, zone, today string) (q.ProgramEnrollment, error) {
	if Lookup(programID) == nil {
		return q.ProgramEnrollment{}, fmt.Errorf("Unknown program: %s", programID)
	}
	if existing, err := s.Active(ctx, uid, programID); err != nil {
		return q.ProgramEnrollment{}, err
	} else if existing != nil {
		return q.ProgramEnrollment{}, errors.New("User already enrolled in this program")
	}
	payload, _ := httpx.Marshal(target)
	baselineEnd := ymdPlus(today, -1)
	evalStart := ymdPlus(today, 14)
	row, err := s.Q.InsertEnrollment(ctx, q.InsertEnrollmentParams{
		UserID: uid, ProgramID: programID, TargetPayload: payload, StartDate: jsontime.YMD(today),
		BaselineWindowStart: jsontime.YMD(ymdPlus(baselineEnd, -27)), BaselineWindowEnd: jsontime.YMD(baselineEnd),
		EvaluationWindowStart: jsontime.YMD(evalStart), EvaluationWindowEnd: jsontime.YMD(ymdPlus(evalStart, 27)),
		RampDays: 14, Timezone: zone,
	})
	return row, err
}

// sqlSetStatus is the statement Drizzle reported for setStatus failures.
func sqlSetStatus(withEnd bool) string {
	set, n := `"status" = $1, "updated_at" = $2`, 3
	if withEnd {
		set, n = `"status" = $1, "end_date" = $2, "updated_at" = $3`, 4
	}
	return `update "program_enrollment" set ` + set + fmt.Sprintf(` where ("program_enrollment"."id" = $%d and "program_enrollment"."user_id" = $%d)`, n, n+1) +
		` returning "id", "user_id", "program_id", "status", "target_payload", "start_date", "end_date", "baseline_window_start", ` +
		`"baseline_window_end", "evaluation_window_start", "evaluation_window_end", "ramp_days", "timezone", "created_at", "updated_at"`
}

// SetStatus is setStatus for pause (paused), resume (active) and end (ended).
func (s *Service) SetStatus(ctx context.Context, uid string, enrollmentID int64, status string) (q.ProgramEnrollment, error) {
	now := s.Now()
	params := q.SetEnrollmentStatusParams{Status: status, Now: jsontime.New(now), UserID: uid}
	nowISO := jsontime.Format(now)
	args := []any{status, nowISO}
	if status == "ended" {
		end := jsontime.YMD(now.UTC().Format(localdate.Layout))
		params.SetEnd, params.EndDate = true, &end
		args = append(args, string(end))
	}
	args = append(args, float64(enrollmentID), uid)
	id, err := db.Int4(enrollmentID)
	var row q.ProgramEnrollment
	if err == nil {
		params.ID = id
		row, err = s.Q.SetEnrollmentStatus(ctx, params)
		if errors.Is(err, pgx.ErrNoRows) {
			return row, errors.New("Enrollment not found")
		}
	}
	if err != nil {
		return row, db.Drizzle(err, sqlSetStatus(status == "ended"), args...)
	}
	return row, nil
}

// Dismiss is recommendationDismissalService.dismiss.
func (s *Service) Dismiss(ctx context.Context, uid, programID string) error {
	return s.Q.DismissRecommendation(ctx, uid, programID, jsontime.New(s.Now()))
}

// Signals is EngineSignals.
type Signals struct {
	FactorLogs     []FactorLog
	HeadacheDays   int
	DiaryCoverage  float64
	AvgOnsetToDose *float64
	AcuteMedDays   int
	Intake         *IntakeHabits
}

// FactorLog is one factorLogsLast14d entry.
type FactorLog struct {
	Factor, Value string
	DaysAgo       float64
}

// IntakeHabits is the intake sleepTrouble/medTiming pair (nil is null).
type IntakeHabits struct{ SleepTrouble, MedTiming *string }

// CollectSignals is collectSignals.
func (s *Service) CollectSignals(ctx context.Context, uid, todayYMD, zone string) (Signals, error) {
	loc := tz.LoadOrUTC(zone)
	today, _ := luxon.FromISO(todayYMD, loc, s.Now())
	date := func(n int) jsontime.Date {
		t, _ := time.Parse(localdate.Layout, ymdPlus(todayYMD, n))
		return jsontime.NewDate(t)
	}
	start28 := luxon.PlusDays(today, loc, -28)
	var sig Signals
	types, err := s.Q.DiaryDayTypesOnly(ctx, uid, date(-13), date(0))
	if err != nil {
		return sig, err
	}
	for _, t := range types {
		if t == "headache_day" || t == "migraine_day" {
			sig.HeadacheDays++
		}
	}
	days28, err := s.Q.DiaryDayTypesOnly(ctx, uid, date(-27), date(0))
	if err != nil {
		return sig, err
	}
	sig.DiaryCoverage = float64(len(days28)) / 28
	events, err := s.Q.FactorEventKeysSince(ctx, uid, jsontime.New(luxon.PlusDays(today, loc, -14)))
	if err != nil {
		return sig, err
	}
	for _, e := range events {
		if e.Key == nil {
			continue
		}
		// Calendar days between the log's local date and today (today is 0).
		logDay := localdate.StartOfDay(e.OccurredAt.Time, loc)
		ago := jsx.Round(luxon.DiffDays(today, loc, logDay, loc))
		sig.FactorLogs = append(sig.FactorLogs, FactorLog{Factor: *e.Key, DaysAgo: ago})
	}
	attacks, err := s.Q.EpisodeOnsetsSince(ctx, uid, jsontime.New(start28))
	if err != nil {
		return sig, err
	}
	doses, err := s.Q.AcuteDosesSince(ctx, uid, jsontime.New(start28))
	if err != nil {
		return sig, err
	}
	earliest := map[int32]time.Time{}
	for _, d := range doses {
		if d.AttackID == nil {
			continue
		}
		if prev, ok := earliest[*d.AttackID]; !ok || d.TakenAt.Before(prev) {
			earliest[*d.AttackID] = d.TakenAt.Time
		}
	}
	var deltas []float64
	for _, a := range attacks {
		dose, ok := earliest[a.ID]
		if !ok {
			continue
		}
		onset := a.StartTime.Time
		if a.OnsetAt != nil {
			onset = a.OnsetAt.Time
		}
		if m := jsx.Round(float64(dose.UnixMilli()-onset.UnixMilli()) / 60000); m >= 0 {
			deltas = append(deltas, m)
		}
	}
	if len(deltas) > 0 {
		sum := 0.0
		for _, d := range deltas {
			sum += d
		}
		avg := jsx.Round(sum / float64(len(deltas)))
		sig.AvgOnsetToDose = &avg
	}
	medDates := map[string]bool{}
	for _, d := range doses {
		medDates[localdate.String(d.TakenAt.Time, zone)] = true
	}
	sig.AcuteMedDays = len(medDates)

	row, err := s.Q.IntakeAnswersStatus(ctx, uid)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return sig, err
	}
	if err == nil && row.Status == "completed" {
		var v any = map[string]any{}
		if len(row.Answers) > 0 && string(row.Answers) != "null" {
			v, _ = zod.Decode(row.Answers)
		}
		if parsed, err := zod.Parse(intake.AnswersSchema, v); err == nil {
			if habits, ok := parsed.(map[string]any)["habits"].(map[string]any); ok {
				h := &IntakeHabits{}
				if s, ok := habits["sleepTrouble"].(string); ok {
					h.SleepTrouble = &s
				}
				if m, ok := habits["medTiming"].(string); ok {
					h.MedTiming = &m
				}
				sig.Intake = h
			}
		}
	}
	return sig, nil
}

var sleepReasons = map[string]string{
	"often": "You told us you often have trouble sleeping.", "sometimes": "You told us you sometimes have trouble sleeping.",
	"rarely": "You told us you rarely have trouble sleeping.",
}

var medTimingReasons = map[string]string{
	"lt30":   "You told us you usually take acute medication within 30 minutes of onset.",
	"30_120": "You told us you usually take acute medication 30 minutes to 2 hours after onset.",
	"gt120":  "You told us you usually take acute medication more than 2 hours after onset.",
	"varies": "You told us your acute medication timing varies.",
}

func evaluate(t Trigger, s Signals) string {
	switch t.Kind {
	case "factor-frequency":
		// Distinct days, not events: three logs on one day are one day.
		days := map[float64]bool{}
		for _, l := range s.FactorLogs {
			if l.Factor == t.Factor && (len(t.Values) == 0 || slices.Contains(t.Values, l.Value)) && l.DaysAgo >= 0 && l.DaysAgo < float64(t.WindowDays) {
				days[l.DaysAgo] = true
			}
		}
		n := len(days)
		label := ""
		if len(t.Values) > 0 {
			label = " as " + strings.Join(t.Values, "/")
		}
		if n >= t.MinDays {
			return fmt.Sprintf("Logged %s%s %d of last %d days.", t.Factor, label, n, t.WindowDays)
		}
	case "headache-rate":
		if s.HeadacheDays >= t.MinHeadacheDays {
			return fmt.Sprintf("Headache on %d of last %d days.", s.HeadacheDays, t.WindowDays)
		}
	case "onset-to-dose":
		if s.AvgOnsetToDose != nil && *s.AvgOnsetToDose > t.AverageMinutesAtLeast {
			return "Acute meds averaged " + jsx.FormatNumber(jsx.Round(*s.AvgOnsetToDose)) + " min after onset."
		}
	case "acute-med-days":
		if s.AcuteMedDays >= t.MinDays {
			return fmt.Sprintf("Acute meds taken on %d of last %d days.", s.AcuteMedDays, t.WindowDays)
		}
	case "intake-answer":
		if s.Intake == nil {
			return ""
		}
		if t.Field == "sleepTrouble" {
			if a := s.Intake.SleepTrouble; a != nil && slices.Contains(t.Values, *a) {
				return sleepReasons[*a]
			}
			return ""
		}
		if a := s.Intake.MedTiming; a != nil && slices.Contains(t.Values, *a) {
			return medTimingReasons[*a]
		}
	}
	return ""
}

// Recommendations is the recommendations route: rankRecommendations plus
// titles.
func (s *Service) Recommendations(ctx context.Context, uid string) ([]any, error) {
	zone, err := usertz.Get(ctx, s.Q, uid)
	if err != nil {
		return nil, err
	}
	today := luxon.ISODate(s.Now().In(tz.LoadOrUTC(zone)))
	sig, err := s.CollectSignals(ctx, uid, today, zone)
	if err != nil {
		return nil, err
	}
	enrollments, err := s.List(ctx, uid)
	if err != nil {
		return nil, err
	}
	dismissed, err := s.Q.ActiveDismissals(ctx, uid, jsontime.New(s.Now().UTC().AddDate(0, 0, -7)))
	if err != nil {
		return nil, err
	}
	var enrolled []string
	for _, e := range enrollments {
		if e.Status == "active" {
			enrolled = append(enrolled, e.ProgramID)
		}
	}
	out := []any{}
	for _, d := range definitions {
		if slices.Contains(enrolled, d.ID) || slices.Contains(dismissed, d.ID) {
			continue
		}
		for _, t := range d.Triggers {
			if reason := evaluate(t, sig); reason != "" {
				out = append(out, httpx.O("id", d.ID, "reason", reason, "title", d.Title))
				break
			}
		}
	}
	return out, nil
}

// Progress is getSleepProgressSummary / getAcuteProgressSummary with
// computeConfidence.
func (s *Service) Progress(ctx context.Context, uid string, e q.ProgramEnrollment, today string, perAttack bool) (*httpx.Object, string, error) {
	count := func(from, to string, headacheOnly bool) (int, error) {
		f, _ := time.Parse(localdate.Layout, from)
		t, _ := time.Parse(localdate.Layout, to)
		types, err := s.Q.DiaryDayTypesOnly(ctx, uid, jsontime.NewDate(f), jsontime.NewDate(t))
		if !headacheOnly || err != nil {
			return len(types), err
		}
		n := 0
		for _, ty := range types {
			if ty == "headache_day" || ty == "migraine_day" {
				n++
			}
		}
		return n, nil
	}
	evalStart, evalEndWin := string(e.EvaluationWindowStart), string(e.EvaluationWindowEnd)
	inEval := today >= evalStart
	evalEnd := min(today, evalEndWin)
	baseHd, err := count(string(e.BaselineWindowStart), string(e.BaselineWindowEnd), true)
	if err != nil {
		return nil, "", err
	}
	baseCov, err := count(string(e.BaselineWindowStart), string(e.BaselineWindowEnd), false)
	if err != nil {
		return nil, "", err
	}
	evalHd, evalCov := 0, 0
	if inEval {
		if evalHd, err = count(evalStart, evalEnd, true); err != nil {
			return nil, "", err
		}
		if evalCov, err = count(evalStart, evalEnd, false); err != nil {
			return nil, "", err
		}
	}
	signals, err := s.Q.AdherenceSignals(ctx, e.ID, perAttack)
	if err != nil {
		return nil, "", err
	}
	due, hits := 0, 0
	for _, sg := range signals {
		if sg != "na" {
			due++
		}
		if sg == "hit" {
			hits++
		}
	}
	adherence := 0.0
	if due > 0 {
		adherence = float64(hits) / float64(due)
	}
	passed := 0
	if inEval {
		a, _ := time.Parse(localdate.Layout, evalStart)
		b, _ := time.Parse(localdate.Layout, evalEnd)
		passed = max(0, min(28, int(math.Floor(float64(b.UnixMilli()-a.UnixMilli())/86400000))+1))
	}
	complete := today >= evalEndWin
	coverage := 0.0
	switch {
	case complete:
		coverage = float64(evalCov) / 28
	case passed != 0:
		coverage = float64(evalCov) / float64(passed)
	}
	evalTotal := passed
	if evalTotal == 0 {
		evalTotal = 28
	}
	baseline := httpx.O("headacheDays", baseHd, "totalDays", 28)
	evaluation := httpx.O("headacheDays", evalHd, "totalDays", evalTotal)
	var comparison *httpx.Object
	if baseHd == 0 {
		dir := "increased"
		if evalHd == 0 {
			dir = "no_change"
		}
		comparison = httpx.O("baseline", baseline, "evaluation", evaluation, "percentChange", 0, "directionLabel", dir)
	} else {
		change := float64(evalHd-baseHd) / float64(baseHd)
		dir := "no_change"
		switch {
		case change < -0.01:
			dir = "reduced"
		case change > 0.01:
			dir = "increased"
		}
		comparison = httpx.O("baseline", baseline, "evaluation", evaluation, "percentChange", jsNum(change), "directionLabel", dir)
	}
	summary := httpx.O("adherence", jsNum(adherence), "coverage", jsNum(coverage), "evalComplete", complete,
		"evalDaysPassed", passed, "baselineCoverage", jsNum(float64(baseCov)/28), "comparison", comparison)

	confidence := "medium"
	switch {
	case !complete || coverage < 0.7 || adherence < 0.4:
		confidence = "low"
	case coverage >= 0.9 && adherence >= 0.7:
		confidence = "high"
	}
	return summary, confidence, nil
}

// jsNum serializes like JSON.stringify (-0 is 0).
type jsNum float64

func (n jsNum) MarshalJSON() ([]byte, error) { return []byte(jsx.FormatNumber(float64(n))), nil }

// errBadAttackID is how Postgres answered an id parameter that is not an
// int4 (a fraction or out of range): the route had no catch, so a 500.
var errBadAttackID = errors.New("invalid input for type integer")

// AttackTiming is the acute-med-timing attack chip: target, onset-to-dose
// minutes and signal. found is false for "Attack not found".
func AttackTiming(ctx context.Context, qs *q.Queries, uid string, id float64, target json.RawMessage) (*httpx.Object, bool, error) {
	if id != math.Trunc(id) || id < math.MinInt32 || id > math.MaxInt32 {
		return nil, false, errBadAttackID
	}
	attackID := int32(id)
	attack, err := qs.AttackOnset(ctx, attackID, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	onset := attack.StartTime.Time
	if attack.OnsetAt != nil {
		onset = attack.OnsetAt.Time
	}
	var minutes *float64
	first, err := qs.FirstDoseForAttack(ctx, &attackID, uid)
	switch {
	case err == nil:
		m := jsx.Round(float64(first.UnixMilli()-onset.UnixMilli()) / 60000)
		minutes = &m
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, false, err
	}
	var t struct {
		AcuteWindowMinutes *float64 `json:"acuteWindowMinutes"`
	}
	_ = json.Unmarshal(target, &t)
	out := httpx.NewObject()
	signal := "miss" // undefined target: every comparison is false
	if t.AcuteWindowMinutes != nil {
		out.Set("targetMinutes", jsNum(*t.AcuteWindowMinutes))
		signal = AcuteSignal(*t.AcuteWindowMinutes, minutes)
	} else if minutes == nil || *minutes < 0 {
		signal = "na"
	}
	var m any
	if minutes != nil {
		m = jsNum(*minutes)
	}
	out.Set("onsetToDoseMinutes", m).Set("signal", signal)
	return out, true, nil
}
