package preventives

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/service/outcomes"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// The errors PreventivePlansService threw by message.
var (
	ErrNotFound = errors.New("Preventive plan not found")
	ErrStopped  = errors.New("Preventive plan is stopped")
	// ErrInvalidToday is the RangeError getDuePlans hit when the localDate
	// query parameter did not parse and the user had active plans.
	ErrInvalidToday = localdate.ErrInvalidTimeValue
)

// The statements Drizzle reported in DrizzleQueryError messages.
const (
	sqlPlanExists  = `select "id" from "preventive_plan" where ("preventive_plan"."user_id" = $1 and "preventive_plan"."id" = $2) limit $3`
	sqlPlanSummary = `select "id", "name", "kind", "dose_text", "schedule_type", "schedule_payload", "start_date", "status", ` +
		`"reminder_times", "reminders_enabled" from "preventive_plan" where ("preventive_plan"."user_id" = $1 and "preventive_plan"."id" = $2) limit $3`
	sqlPlanInsert = `insert into "preventive_plan" ("id", "user_id", "catalog_medication_id", "name", "kind", "dose_text", ` +
		`"schedule_type", "schedule_payload", "start_date", "reminder_times", "reminders_enabled", "status", "paused_at", ` +
		`"stopped_at", "stop_reason", "stop_reason_note", "updated_at", "created_at") values (default, $1, $2, $3, $4, $5, $6, ` +
		`$7, $8, $9, $10, $11, $12, $13, $14, $15, default, default) returning "id"`
)

// defaultTimezone replaces "UTC" (resolveTimezone).
const defaultTimezone = "Europe/Berlin"

func resolveTimezone(name string) string {
	if name == "UTC" {
		return defaultTimezone
	}
	return name
}

var spaceRun = regexp.MustCompile(`\s+`)

// normalizeName is normalizeName: trimmed, inner whitespace collapsed, lower.
func normalizeName(name string) string {
	return strings.ToLower(spaceRun.ReplaceAllString(jsx.Trim(name), " "))
}

// Service is PreventivePlansService.
type Service struct {
	Q   *q.Queries
	Now func() time.Time
}

func (s *Service) timezone(ctx context.Context, uid string) (string, *time.Location, error) {
	name, err := usertz.Get(ctx, s.Q, uid)
	if err != nil {
		return "", nil, err
	}
	name = resolveTimezone(name)
	return name, tz.LoadOrUTC(name), nil
}

func planOf(r q.PreventivePlan) Plan {
	return Plan{ID: r.ID, Kind: r.Kind, ScheduleType: r.ScheduleType, Payload: DecodePayload(r.SchedulePayload),
		StartDate: r.StartDate.YMD(), Status: r.Status}
}

// rawOr is `value ?? fallback` for a jsonb column read by the pg driver.
func rawOr(raw json.RawMessage, fallback string) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage(fallback)
	}
	return raw
}

func payloadJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("null")
	}
	return raw
}

func isoOrNil(t *jsontime.Time) any {
	if t == nil {
		return nil
	}
	return jsontime.Format(t.Time)
}

// List is listPlans.
func (s *Service) List(ctx context.Context, uid string) ([]*httpx.Object, error) {
	rows, err := s.Q.ListPreventivePlans(ctx, uid)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, r := range rows {
		counts[normalizeName(r.Name)]++
	}
	out := make([]*httpx.Object, 0, len(rows))
	for _, r := range rows {
		out = append(out, httpx.O(
			"id", r.ID, "name", r.Name, "kind", r.Kind, "doseText", r.DoseText, "scheduleType", r.ScheduleType,
			"schedulePayload", payloadJSON(r.SchedulePayload), "scheduleLabel", ScheduleLabel(planOf(r)),
			"startDate", r.StartDate.YMD(), "status", r.Status, "pausedAt", isoOrNil(r.PausedAt),
			"stoppedAt", isoOrNil(r.StoppedAt), "stopReason", r.StopReason, "stopReasonNote", r.StopReasonNote,
			"createdAt", jsontime.Format(r.CreatedAt.Time), "updatedAt", jsontime.Format(r.UpdatedAt.Time),
			"reminderTimes", rawOr(r.ReminderTimes, "[]"), "remindersEnabled", r.RemindersEnabled,
			"isDuplicateName", counts[normalizeName(r.Name)] > 1,
		))
	}
	return out, nil
}

// CreateInput is CreatePreventivePlanInput after parsing; absent optional
// keys are nil.
type CreateInput struct {
	CatalogMedicationID *string
	Name                string
	Kind                string
	DoseText            *string
	ScheduleType        string
	SchedulePayload     any // nil for null or absent
	StartDate           string
	ReminderTimes       []string // nil when absent
	RemindersEnabled    *bool
}

func payloadOrEmpty(v any) json.RawMessage {
	if v == nil {
		return json.RawMessage("{}")
	}
	b, _ := httpx.Marshal(v)
	return b
}

func reminderJSON(times []string) json.RawMessage {
	if times == nil {
		times = []string{}
	}
	b, _ := httpx.Marshal(times)
	return b
}

func trimmed(s *string) *string {
	if s == nil {
		return nil
	}
	v := jsx.Trim(*s)
	return &v
}

func nilable[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

// Create is createPlan.
func (s *Service) Create(ctx context.Context, uid string, in CreateInput) (string, error) {
	start, err := localdate.JSDateFromYMD(in.StartDate)
	if err != nil {
		return "", err
	}
	enabled := in.RemindersEnabled != nil && *in.RemindersEnabled
	payload, reminders := payloadOrEmpty(in.SchedulePayload), reminderJSON(in.ReminderTimes)
	dose := trimmed(in.DoseText)
	name := jsx.Trim(in.Name)
	id, err := s.Q.CreatePreventivePlan(ctx, q.CreatePreventivePlanParams{
		UserID: uid, CatalogMedicationID: in.CatalogMedicationID, Name: name, Kind: in.Kind, DoseText: dose,
		ScheduleType: in.ScheduleType, SchedulePayload: payload, StartDate: jsontime.NewDate(start),
		ReminderTimes: reminders, RemindersEnabled: enabled,
	})
	if err != nil {
		return "", db.Drizzle(err, sqlPlanInsert, uid, nilable(in.CatalogMedicationID), name, in.Kind, nilable(dose),
			in.ScheduleType, string(payload), jsontime.Format(start), string(reminders), enabled, "active", nil, nil, nil, nil)
	}
	return id, nil
}

// Patch is UpdatePreventivePlanInput; Set* mark keys present in the input.
type Patch struct {
	Name, Kind, ScheduleType, StartDate *string
	SetDoseText                         bool
	DoseText                            *string
	SetSchedulePayload                  bool
	SchedulePayload                     any
	ReminderTimes                       []string // nil when absent
	RemindersEnabled                    *bool
}

func (s *Service) exists(ctx context.Context, uid, id, stmt string) (q.PreventivePlan, error) {
	r, err := s.Q.GetPreventivePlan(ctx, uid, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if err != nil {
		return r, db.Drizzle(err, stmt, uid, id, 1)
	}
	return r, nil
}

// Update is updatePlan.
func (s *Service) Update(ctx context.Context, uid, id string, p Patch) error {
	if _, err := s.exists(ctx, uid, id, sqlPlanExists); err != nil {
		return err
	}
	params := q.UpdatePreventivePlanParams{
		Kind: p.Kind, ScheduleType: p.ScheduleType, RemindersEnabled: p.RemindersEnabled,
		SetDoseText: p.SetDoseText, DoseText: trimmed(p.DoseText),
		Now: jsontime.New(s.Now()), UserID: uid, ID: id,
	}
	params.Name = trimmed(p.Name)
	if p.SetSchedulePayload {
		params.SetSchedulePayload = true
		params.SchedulePayload = payloadOrEmpty(p.SchedulePayload)
	}
	if p.StartDate != nil {
		d, err := localdate.JSDateFromYMD(*p.StartDate)
		if err != nil {
			return err
		}
		params.StartDate = jsontime.NewDate(d)
	}
	if p.ReminderTimes != nil {
		params.ReminderTimes = reminderJSON(p.ReminderTimes)
	}
	return s.Q.UpdatePreventivePlan(ctx, params)
}

// SetStatus is setStatus.
func (s *Service) SetStatus(ctx context.Context, uid, id, next string, reason, note *string) error {
	r, err := s.Q.GetPreventivePlan(ctx, uid, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if r.Status == next {
		return nil
	}
	now := jsontime.New(s.Now())
	params := q.SetPreventivePlanStatusParams{Status: next, Now: now, UserID: uid, ID: id}
	switch next {
	case "paused":
		params.PausedAt = &now
	case "stopped":
		params.StoppedAt, params.StopReason, params.StopReasonNote = &now, reason, note
	}
	if err := s.Q.SetPreventivePlanStatus(ctx, params); err != nil {
		return err
	}
	return s.Q.InsertPreventiveStatusChange(ctx, q.InsertPreventiveStatusChangeParams{
		UserID: uid, PlanID: id, FromStatus: r.Status, ToStatus: next, ChangedAt: now, Reason: reason, ReasonNote: note,
	})
}

// Delete is deletePlan.
func (s *Service) Delete(ctx context.Context, uid, id string) error {
	return s.Q.DeletePreventivePlan(ctx, uid, id)
}

// IntakeInput is PreventiveIntakeUpsertInput.
type IntakeInput struct {
	PlanID    string  `json:"planId"`
	LocalDate string  `json:"localDate"`
	State     string  `json:"state"`
	Note      *string `json:"note"`
}

// UpsertIntake is upsertIntake.
func (s *Service) UpsertIntake(ctx context.Context, uid string, in IntakeInput) error {
	r, err := s.Q.GetPreventivePlan(ctx, uid, in.PlanID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if r.Status == "stopped" {
		return ErrStopped
	}
	day, err := localdate.JSDateFromYMD(in.LocalDate)
	if err != nil {
		return err
	}
	now := jsontime.New(s.Now())
	var takenAt *jsontime.Time
	if in.State == "taken" {
		takenAt = &now
	}
	return s.Q.UpsertPreventiveIntake(ctx, q.UpsertPreventiveIntakeParams{
		UserID: uid, PlanID: in.PlanID, LocalDate: jsontime.NewDate(day), State: in.State,
		TakenAt: takenAt, Note: trimmed(in.Note), CreatedAt: now,
	})
}

// CheckInInput is PreventiveWeeklyCheckInInput.
type CheckInInput struct {
	PlanID             string  `json:"planId"`
	WeekStartLocalDate string  `json:"weekStartLocalDate"`
	SideEffects        string  `json:"sideEffects"`
	StillTaking        string  `json:"stillTaking"`
	Note               *string `json:"note"`
}

// WeeklyCheckIn is createWeeklyCheckIn.
func (s *Service) WeeklyCheckIn(ctx context.Context, uid string, in CheckInInput) error {
	_, err := s.Q.GetPreventivePlan(ctx, uid, in.PlanID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	week, err := localdate.JSDateFromYMD(in.WeekStartLocalDate)
	if err != nil {
		return err
	}
	return s.Q.UpsertPreventiveWeeklyCheckIn(ctx, q.UpsertPreventiveWeeklyCheckInParams{
		UserID: uid, PlanID: in.PlanID, WeekStart: jsontime.NewDate(week), SideEffects: in.SideEffects,
		StillTaking: in.StillTaking, Note: trimmed(in.Note), CreatedAt: jsontime.New(s.Now()),
	})
}

func eventsByPlan(rows []q.PreventiveIntakesForPlansRow) map[string][]IntakeEvent {
	out := map[string][]IntakeEvent{}
	for _, e := range rows {
		out[e.PlanID] = append(out[e.PlanID], IntakeEvent{LocalDate: e.LocalDate.YMD(), State: e.State})
	}
	return out
}

func planIDs(rows []q.PreventivePlan) []string {
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	return ids
}

func dbDate(ymdStr string) jsontime.Date { return jsontime.NewDate(civil(ymdStr)) }

// Due is getDuePlans. localDate "" means the parameter was absent or empty.
func (s *Service) Due(ctx context.Context, uid, localDate string) (*httpx.Object, error) {
	zone, loc, err := s.timezone(ctx, uid)
	if err != nil {
		return nil, err
	}
	var today any
	todayStr := ""
	if localDate != "" {
		if t, ok := luxon.FromISO(localDate, loc, s.Now()); ok {
			todayStr = luxon.ISODate(t)
		}
	} else {
		todayStr = luxon.ISODate(s.Now().In(loc))
	}
	if todayStr != "" {
		today = todayStr
	}

	plans, err := s.Q.ActivePreventivePlans(ctx, uid)
	if err != nil {
		return nil, err
	}
	if len(plans) == 0 {
		return httpx.O("timezone", zone, "todayLocalDate", today, "due", []any{}, "notDue", []any{}, "hasActivePlans", false), nil
	}
	if todayStr == "" {
		return nil, ErrInvalidToday
	}
	rows, err := s.Q.PreventiveIntakesForPlans(ctx, uid, planIDs(plans), dbDate(addDays(todayStr, -7)), dbDate(addDays(todayStr, 7)))
	if err != nil {
		return nil, err
	}
	byPlan := eventsByPlan(rows)
	due, notDue := []any{}, []any{}
	for _, r := range plans {
		p := planOf(r)
		st := GetDueStatus(p, todayStr, byPlan[r.ID])
		label := ScheduleLabel(p)
		if st.IsDue || st.IsOverdue {
			var state any
			if st.MatchedEvent != nil {
				state = st.MatchedEvent.State
			}
			due = append(due, httpx.O("id", r.ID, "name", r.Name, "kind", r.Kind, "scheduleLabel", label,
				"isOverdue", st.IsOverdue, "state", state))
		} else {
			notDue = append(notDue, httpx.O("id", r.ID, "name", r.Name, "kind", r.Kind, "scheduleLabel", label))
		}
	}
	return httpx.O("timezone", zone, "todayLocalDate", today, "due", due, "notDue", notDue, "hasActivePlans", true), nil
}

// RecentInsight is getRecentInsight; nil is null.
func (s *Service) RecentInsight(ctx context.Context, uid string) (*httpx.Object, error) {
	_, loc, err := s.timezone(ctx, uid)
	if err != nil {
		return nil, err
	}
	to := luxon.ISODate(s.Now().In(loc))
	from := addDays(to, -6)
	plans, err := s.Q.ActivePreventivePlansUnordered(ctx, uid)
	if err != nil || len(plans) == 0 {
		return nil, err
	}
	rows, err := s.Q.PreventiveIntakesForPlans(ctx, uid, planIDs(plans), dbDate(from), dbDate(to))
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	byPlan := eventsByPlan(rows)
	taken, missed := 0, 0
	for _, r := range plans {
		a := ResolveAdherenceForRange(planOf(r), from, to, byPlan[r.ID])
		taken += a.Taken
		missed += a.Missed
	}
	var pct any
	if taken+missed > 0 {
		pct = float64(taken) / float64(taken+missed)
	}
	diary, err := s.Q.DiaryDayTypesBetween(ctx, uid, dbDate(from), dbDate(to))
	if err != nil {
		return nil, err
	}
	migraine := 0
	for _, d := range diary {
		if d.DayType == "migraine_day" {
			migraine++
		}
	}
	return httpx.O("adherencePct", pct, "migraineDays", migraine, "from", from, "to", to), nil
}

// Detail is getPlanDetail; nil when the plan is not the user's.
func (s *Service) Detail(ctx context.Context, uid, id string) (*httpx.Object, error) {
	r, err := s.Q.GetPreventivePlan(ctx, uid, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return httpx.O("id", r.ID, "name", r.Name, "kind", r.Kind, "doseText", r.DoseText, "scheduleType", r.ScheduleType,
		"schedulePayload", payloadJSON(r.SchedulePayload), "startDate", r.StartDate.YMD(), "status", r.Status), nil
}

func periodJSON(from, to string, t outcomes.Totals) *httpx.Object {
	return httpx.O("from", from, "to", to, "mmd", t.MmdMin, "mhd", t.MhdMin,
		"acuteMedicationDays", t.AcuteMedicationDays, "coverage", t.Coverage)
}

func diaryBetween(days []outcomes.DiaryDay, from, to string) []outcomes.DiaryDay {
	out := []outcomes.DiaryDay{}
	for _, d := range days {
		if d.LocalDate >= from && d.LocalDate <= to {
			out = append(out, d)
		}
	}
	return out
}

func intakesBetween(in []outcomes.MedicationIntake, zone, from, to string) []outcomes.MedicationIntake {
	out := []outcomes.MedicationIntake{}
	for _, e := range in {
		if local := localdate.String(e.TakenAt, zone); local >= from && local <= to {
			out = append(out, e)
		}
	}
	return out
}

func firstNonNil(ps ...*string) string {
	for _, p := range ps {
		if p != nil {
			return *p
		}
	}
	return ""
}

// Summary is getPlanSummary.
func (s *Service) Summary(ctx context.Context, uid, id string) (*httpx.Object, error) {
	zone, loc, err := s.timezone(ctx, uid)
	if err != nil {
		return nil, err
	}
	r, err := s.exists(ctx, uid, id, sqlPlanSummary)
	if err != nil {
		return nil, err
	}
	p := planOf(r)
	today := luxon.ISODate(s.Now().In(loc))
	w := ResolvePlanWindows(p.StartDate, today)
	maxTo := max(today, w.EvalLongTo)

	diaryRows, err := s.Q.DiaryDayTypesBetween(ctx, uid, dbDate(w.BaselineFrom), dbDate(maxTo))
	if err != nil {
		return nil, err
	}
	diary := make([]outcomes.DiaryDay, len(diaryRows))
	for i, d := range diaryRows {
		diary[i] = outcomes.DiaryDay{LocalDate: d.LocalDate.YMD(), DayType: d.DayType}
	}
	fromTS, _ := localdate.ParseInZone(w.BaselineFrom, loc)
	toTS, _ := localdate.ParseInZone(addDays(maxTo, 1), loc)
	intakeRows, err := s.Q.MedicationIntakeNamesBetween(ctx, uid, jsontime.New(fromTS), jsontime.New(toTS))
	if err != nil {
		return nil, err
	}
	intakes := make([]outcomes.MedicationIntake, len(intakeRows))
	for i, m := range intakeRows {
		intakes[i] = outcomes.MedicationIntake{TakenAt: m.TakenAt.Time, Name: jsx.Trim(firstNonNil(m.MedicationName, m.CustomName, m.CanonicalName))}
	}

	baseline := outcomes.ComputeForRange(zone, BaselineDays, w.BaselineFrom, w.BaselineTo, diaryBetween(diary, w.BaselineFrom, w.BaselineTo), nil)
	var evaluation, evaluationLong *outcomes.Result
	if w.HasEvalData {
		e := outcomes.ComputeForRange(zone, EvalDays, w.EvalFrom, w.EvalEnd, diaryBetween(diary, w.EvalFrom, w.EvalEnd),
			intakesBetween(intakes, zone, w.EvalFrom, w.EvalEnd))
		evaluation = &e
	}
	if w.EvalLongEnd >= w.EvalFrom {
		e := outcomes.ComputeForRange(zone, ExtendedEvalDays, w.EvalFrom, w.EvalLongEnd, diaryBetween(diary, w.EvalFrom, w.EvalLongEnd),
			intakesBetween(intakes, zone, w.EvalFrom, w.EvalLongEnd))
		evaluationLong = &e
	}

	last7From, last28From := addDays(today, -6), addDays(today, -27)
	evRows, err := s.Q.PreventiveIntakesForPlan(ctx, uid, id, dbDate(last28From), dbDate(today))
	if err != nil {
		return nil, err
	}
	events := make([]IntakeEvent, len(evRows))
	for i, e := range evRows {
		events[i] = IntakeEvent{LocalDate: e.LocalDate.YMD(), State: e.State}
	}

	var evalJSON, longJSON any
	if evaluation != nil {
		t := evaluation.Totals
		var pct any
		if baseline.Totals.MmdMin != 0 {
			pct = float64(t.MmdMin-baseline.Totals.MmdMin) / float64(baseline.Totals.MmdMin)
		}
		status, missingDays := "NOT_ENOUGH_DATA", 0
		pending := max(0, daysBetween(civil(w.EvalEnd), civil(w.EvalTo)))
		missingCoverage := t.Coverage.TotalDays - t.Coverage.RecordedDays
		if missingCoverage > 0 || pending > 0 {
			missingDays = missingCoverage + pending
		} else {
			status = outcomes.ComputeResponder50(baseline.Totals.MmdMin, t.MmdMin).Status
		}
		evalJSON = periodJSON(w.EvalFrom, w.EvalEnd, t).Set("percentChangeMmd", pct).
			Set("responder50", status).Set("missingDaysNeeded", missingDays)
	}
	if evaluationLong != nil {
		longJSON = periodJSON(w.EvalFrom, w.EvalLongEnd, evaluationLong.Totals)
	}

	return httpx.O(
		"timezone", zone,
		"plan", httpx.O("id", r.ID, "name", r.Name, "kind", r.Kind, "doseText", r.DoseText,
			"scheduleLabel", ScheduleLabel(p), "scheduleType", r.ScheduleType, "schedulePayload", payloadJSON(r.SchedulePayload),
			"startDate", p.StartDate, "status", r.Status, "reminderTimes", rawOr(r.ReminderTimes, "[]"),
			"remindersEnabled", r.RemindersEnabled),
		"baseline", periodJSON(w.BaselineFrom, w.BaselineTo, baseline.Totals),
		"evaluation", evalJSON,
		"evaluationLong", longJSON,
		"adherence", httpx.O("last7", ResolveAdherenceForRange(p, last7From, today, events),
			"last28", ResolveAdherenceForRange(p, last28From, today, events)),
		"timelineWeeks", timelineWeeks(p, today, diary, events),
	), nil
}

func startOfWeek(date string) time.Time {
	d := civil(date)
	return d.AddDate(0, 0, -(weekday(d) - 1))
}

func timelineWeeks(p Plan, today string, diary []outcomes.DiaryDay, events []IntakeEvent) []*httpx.Object {
	weeks := []*httpx.Object{}
	end := startOfWeek(today)
	for cur := startOfWeek(p.StartDate); !cur.After(end); cur = cur.AddDate(0, 0, 7) {
		ws, we := ymd(cur), ymd(cur.AddDate(0, 0, 6))
		migraine := 0
		for _, d := range diaryBetween(diary, ws, we) {
			if d.DayType == "migraine_day" {
				migraine++
			}
		}
		a := ResolveAdherenceForRange(p, ws, we, events)
		var pct any
		if a.Taken+a.Missed > 0 {
			pct = float64(a.Taken) / float64(a.Taken+a.Missed)
		}
		weeks = append(weeks, httpx.O("weekStart", ws, "migraineDays", migraine, "adherence", pct))
	}
	return weeks[max(0, len(weeks)-12):]
}
