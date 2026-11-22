package diary

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/programs"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// Error is DailyDiaryError.
type Error struct {
	Code    string
	Message string
	Details any
}

func (e *Error) Error() string { return e.Message }

// Service is DailyDiaryService.
type Service struct {
	Q   *q.Queries
	Now func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// datesInclusive is listLocalDatesInclusive.
func datesInclusive(from, to, zone string) ([]string, error) {
	loc, ok := tz.Load(zone)
	if !ok {
		return nil, &Error{Code: "VALIDATION_ERROR", Message: "Invalid date range"}
	}
	start, ok1 := localdate.ParseInZone(from, loc)
	end, ok2 := localdate.ParseInZone(to, loc)
	if !ok1 || !ok2 || end.Before(start) {
		return nil, &Error{Code: "VALIDATION_ERROR", Message: "Invalid date range"}
	}
	var out []string
	for cur := start; !cur.After(end); {
		out = append(out, cur.Format(localdate.Layout))
		n := cur.AddDate(0, 0, 1)
		cur = time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, loc)
	}
	return out, nil
}

// dayWindow is [start of day, start of next day) in UTC for a local date.
func dayWindow(from, to, zone string) (time.Time, time.Time) {
	loc := tz.LoadOrUTC(zone)
	s, _ := localdate.ParseInZone(from, loc)
	e, _ := localdate.ParseInZone(to, loc)
	n := e.AddDate(0, 0, 1)
	n = time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, loc)
	return s.UTC(), n.UTC()
}

func dbDate(ymd string) jsontime.Date {
	d, _ := localdate.YMDToDBDate(ymd)
	return jsontime.NewDate(d)
}

// DTO is toDto.
func DTO(row q.DailyDiaryEntry) *httpx.Object {
	createdFrom := row.CreatedFrom
	if createdFrom == "" {
		createdFrom = "user"
	}
	return httpx.O(
		"id", row.ID, "userId", row.UserID, "localDate", row.LocalDate.YMD(), "timezone", row.Timezone,
		"dayType", row.DayType, "createdFrom", createdFrom, "impact", row.Impact, "notes", row.Notes,
		"bedTimeLocal", row.BedTimeLocal, "wakeTimeLocal", row.WakeTimeLocal,
		"createdAt", jsontime.Format(row.CreatedAt.Time), "updatedAt", jsontime.Format(row.UpdatedAt.Time),
	)
}

func ongoingEnd(end *jsontime.Time, ongoing bool, now time.Time) *time.Time {
	if end != nil {
		t := end.Time
		return &t
	}
	if ongoing {
		return &now
	}
	return nil
}

// Range is getDailyDiaryRange.
func (s *Service) Range(ctx context.Context, userID, from, to string) (*httpx.Object, error) {
	zone, err := usertz.Get(ctx, s.Q, userID)
	if err != nil {
		return nil, err
	}
	days, err := datesInclusive(from, to, zone)
	if err != nil {
		return nil, err
	}
	rs, re := dayWindow(from, to, zone)
	episodes, err := s.Q.EpisodesInWindow(ctx, userID, jsontime.New(re), jsontime.Ptr(rs))
	if err != nil {
		return nil, err
	}
	now := s.now()
	attackSet := map[string]bool{}
	for _, ep := range episodes {
		for _, d := range localdate.Overlapped(ep.StartTime.Time, ongoingEnd(ep.EndTime, ep.IsOngoing, now), zone) {
			if d >= from && d <= to {
				attackSet[d] = true
			}
		}
	}
	attackDays := sortedKeys(attackSet)
	if len(attackDays) > 0 {
		if _, err := Recompute(ctx, s.Q, userID, attackDays, zone, now); err != nil {
			return nil, err
		}
	}
	rows, err := s.Q.DiaryRowsBetween(ctx, userID, dbDate(from), dbDate(to))
	if err != nil {
		return nil, err
	}
	entries := make([]any, len(rows))
	for i, r := range rows {
		entries[i] = DTO(r)
	}
	intakes, err := s.Q.IntakeTimesBetween(ctx, userID, jsontime.New(rs), jsontime.New(re))
	if err != nil {
		return nil, err
	}
	doses, err := s.Q.AcuteDoseTimesBetween(ctx, userID, jsontime.New(rs), jsontime.New(re))
	if err != nil {
		return nil, err
	}
	medSet := map[string]bool{}
	for _, t := range append(intakes, doses...) {
		medSet[localdate.String(t.Time, zone)] = true
	}
	return httpx.O(
		"timezone", zone,
		"entries", entries,
		"attackDays", attackDays,
		"medicationDays", sortedKeys(medSet),
		"coverage", httpx.O("totalDays", len(days), "recordedDays", len(entries), "missingDays", len(days)-len(entries)),
	), nil
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Today is getTodayDiaryState.
func (s *Service) Today(ctx context.Context, userID string) (*httpx.Object, error) {
	zone, err := usertz.Get(ctx, s.Q, userID)
	if err != nil {
		return nil, err
	}
	today := localdate.String(s.now(), zone)
	if _, err := Recompute(ctx, s.Q, userID, []string{today}, zone, s.now()); err != nil {
		return nil, err
	}
	var entry any
	row, err := s.Q.DiaryRowAt(ctx, userID, dbDate(today))
	switch {
	case err == nil:
		entry = DTO(row)
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}
	return httpx.O("timezone", zone, "todayLocalDate", today, "entry", entry), nil
}

// Overlap is getAttackOverlapDays (sorted).
func (s *Service) Overlap(ctx context.Context, userID, from, to string) ([]string, error) {
	zone, err := usertz.Get(ctx, s.Q, userID)
	if err != nil {
		return nil, err
	}
	rs, re := dayWindow(from, to, zone)
	episodes, err := s.Q.EpisodesInWindow(ctx, userID, jsontime.New(re), jsontime.Ptr(rs))
	if err != nil {
		return nil, err
	}
	days, err := datesInclusive(from, to, zone)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	for _, d := range days {
		allowed[d] = true
	}
	out := map[string]bool{}
	now := s.now()
	for _, ep := range episodes {
		for _, d := range localdate.Overlapped(ep.StartTime.Time, ongoingEnd(ep.EndTime, ep.IsOngoing, now), zone) {
			if allowed[d] {
				out[d] = true
			}
		}
	}
	return sortedKeys(out), nil
}

// Patch is UpsertDailyDiaryPatch. A key present with null is Set with a nil
// value; an absent key is not Set.
type Patch struct {
	set    map[string]bool
	DayType       *string
	Impact        *float64
	Notes         *string
	BedTimeLocal  *string
	WakeTimeLocal *string
}

// Has reports whether the patch carries the key (Object.hasOwn).
func (p Patch) Has(k string) bool { return p.set[k] }

// PatchFrom builds a patch from a parsed body object.
func PatchFrom(m map[string]any) Patch {
	p := Patch{set: map[string]bool{}}
	str := func(k string) *string {
		if v, ok := m[k].(string); ok {
			return &v
		}
		return nil
	}
	for k, v := range m {
		p.set[k] = true
		switch k {
		case "dayType":
			p.DayType = str(k)
		case "impact":
			if f, ok := v.(float64); ok {
				p.Impact = &f
			}
		case "notes":
			p.Notes = str(k)
		case "bedTimeLocal":
			p.BedTimeLocal = str(k)
		case "wakeTimeLocal":
			p.WakeTimeLocal = str(k)
		}
	}
	return p
}

var hhmm = regexp.MustCompile(`^(?:[01]\d|2[0-3]):[0-5]\d$`)

func validatePatch(p Patch) error {
	if p.DayType != nil && *p.DayType != "" && *p.DayType != "headache_free" && *p.DayType != "headache_day" && *p.DayType != "migraine_day" {
		return &Error{Code: "VALIDATION_ERROR", Message: "Invalid dayType"}
	}
	if p.Impact != nil && (*p.Impact != float64(int(*p.Impact)) || *p.Impact < 0 || *p.Impact > 4) {
		return &Error{Code: "VALIDATION_ERROR", Message: "impact must be an integer in range 0..4"}
	}
	if p.Notes != nil && jsx.Len(*p.Notes) > 2000 {
		return &Error{Code: "VALIDATION_ERROR", Message: "notes too long"}
	}
	for k, v := range map[string]*string{"bedTimeLocal": p.BedTimeLocal, "wakeTimeLocal": p.WakeTimeLocal} {
		if v != nil && !hhmm.MatchString(*v) {
			return &Error{Code: "VALIDATION_ERROR", Message: k + " must be HH:MM"}
		}
	}
	return nil
}

type evidence struct{ migraine, headache bool }

func (s *Service) evidenceFor(ctx context.Context, userID, ymd, zone string, now time.Time) (evidence, error) {
	rs, re := dayWindow(ymd, ymd, zone)
	episodes, err := s.Q.EpisodesInWindow(ctx, userID, jsontime.New(re), jsontime.Ptr(rs))
	if err != nil {
		return evidence{}, err
	}
	var ev evidence
	for _, ep := range episodes {
		for _, d := range localdate.Overlapped(ep.StartTime.Time, ongoingEnd(ep.EndTime, ep.IsOngoing, now), zone) {
			if d != ymd {
				continue
			}
			if ep.AttackType == "headache" {
				ev.headache = true
			} else {
				ev.migraine = true
			}
		}
	}
	return ev, nil
}

func clockPtr(s *string) *jsontime.Clock {
	if s == nil {
		return nil
	}
	c := jsontime.Clock(*s)
	return &c
}

func clockStr(c *jsontime.Clock) *string {
	if c == nil {
		return nil
	}
	s := string(*c)
	return &s
}

// Upsert is upsertDailyDiaryEntry.
func (s *Service) Upsert(ctx context.Context, userID, ymd string, p Patch) (*httpx.Object, error) {
	zone, err := usertz.Get(ctx, s.Q, userID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	if !localdate.IsEditable(ymd, now, zone) {
		return nil, &Error{Code: "NOT_EDITABLE", Message: "This day is outside the editing window (last 30 days).", Details: httpx.O("localDate", ymd)}
	}
	if err := validatePatch(p); err != nil {
		return nil, err
	}
	var existing *q.DailyDiaryEntry
	row, err := s.Q.DiaryRowAt(ctx, userID, dbDate(ymd))
	switch {
	case err == nil:
		existing = &row
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}
	hasDayType := p.DayType != nil && *p.DayType != ""
	if existing == nil && !hasDayType {
		return nil, &Error{Code: "VALIDATION_ERROR", Message: "dayType is required to create a diary entry"}
	}
	requested := ""
	switch {
	case hasDayType:
		requested = *p.DayType
	case existing != nil:
		requested = existing.DayType
	}
	if requested == "" {
		return nil, &Error{Code: "VALIDATION_ERROR", Message: "dayType is required"}
	}

	ev, err := s.evidenceFor(ctx, userID, ymd, zone, now)
	if err != nil {
		return nil, err
	}
	evidenceType := StrongestDayType(ev.migraine, ev.headache)
	if evidenceType == "migraine_day" && p.Has("dayType") && requested != "migraine_day" {
		return nil, &Error{Code: "MIGRAINE_DAY_REQUIRED", Message: "Not available because a migraine attack exists for this day.", Details: httpx.O("localDate", ymd)}
	}
	if requested == "headache_free" && evidenceType != "" {
		return nil, &Error{Code: "HEADACHE_FREE_NOT_ALLOWED", Message: "Not available because an attack exists for this day.", Details: httpx.O("localDate", ymd)}
	}

	if requested == "migraine_day" && evidenceType == "headache_day" && ev.headache && !ev.migraine {
		rs, re := dayWindow(ymd, ymd, zone)
		heads, err := s.Q.HeadacheEpisodesInWindow(ctx, userID, jsontime.New(re), jsontime.Ptr(rs))
		if err != nil {
			return nil, err
		}
		if len(heads) > 0 {
			ids := make([]int32, len(heads))
			touched := []string{ymd}
			for i, h := range heads {
				ids[i] = h.ID
				var end *time.Time
				if h.EndTime != nil {
					e := h.EndTime.Time
					end = &e
				}
				touched = append(touched, TouchedDates(h.StartTime.Time, end, h.IsOngoing, now, zone)...)
			}
			if err := s.Q.PromoteEpisodesToMigraine(ctx, jsontime.New(time.Now()), userID, ids); err != nil {
				return nil, err
			}
			if _, err := Recompute(ctx, s.Q, userID, touched, zone, now); err != nil {
				return nil, err
			}
		}
	}

	next := requested
	switch evidenceType {
	case "migraine_day":
		next = "migraine_day"
	case "headache_day":
		if requested != "migraine_day" {
			next = "headache_day"
		}
	}

	var exImpact *int32
	var exNotes *string
	var exBed, exWake *string
	if existing != nil {
		exImpact, exNotes = existing.Impact, existing.Notes
		exBed, exWake = clockStr(existing.BedTimeLocal), clockStr(existing.WakeTimeLocal)
	}
	impact := exImpact
	if p.Has("impact") {
		impact = nil
		if p.Impact != nil {
			v := int32(*p.Impact)
			impact = &v
		}
	}
	notes := exNotes
	if p.Has("notes") {
		notes = p.Notes
	}
	bed := exBed
	if p.Has("bedTimeLocal") {
		bed = p.BedTimeLocal
	}
	wake := exWake
	if p.Has("wakeTimeLocal") {
		wake = p.WakeTimeLocal
	}

	saved, err := s.Q.UpsertUserDiaryEntry(ctx, q.UpsertUserDiaryEntryParams{
		UserID: userID, LocalDate: dbDate(ymd), Timezone: zone, DayType: next,
		Impact: impact, Notes: notes, BedTimeLocal: clockPtr(bed), WakeTimeLocal: clockPtr(wake),
		Now: jsontime.New(time.Now()),
	})
	if err != nil {
		return nil, err
	}
	if p.Has("bedTimeLocal") || p.Has("wakeTimeLocal") {
		if err := programs.RecordSleepAdherence(ctx, s.Q, userID, ymd, bed, wake, ""); err != nil {
			return nil, err
		}
	}
	return DTO(saved), nil
}

// Day is getDayDetail.
func (s *Service) Day(ctx context.Context, userID, ymd string) (*httpx.Object, error) {
	zone, err := usertz.Get(ctx, s.Q, userID)
	if err != nil {
		return nil, err
	}
	if _, err := Recompute(ctx, s.Q, userID, []string{ymd}, zone, s.now()); err != nil {
		return nil, err
	}
	rs, re := dayWindow(ymd, ymd, zone)
	var entry any
	row, err := s.Q.DiaryRowAt(ctx, userID, dbDate(ymd))
	switch {
	case err == nil:
		entry = DTO(row)
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}
	attacks, err := s.Q.EpisodesInWindow(ctx, userID, jsontime.New(re), jsontime.Ptr(rs))
	if err != nil {
		return nil, err
	}
	intakes, err := s.Q.DayMedicationIntakes(ctx, userID, jsontime.New(rs), jsontime.New(re))
	if err != nil {
		return nil, err
	}
	doses, err := s.Q.DayAcuteDoses(ctx, userID, jsontime.New(rs), jsontime.New(re))
	if err != nil {
		return nil, err
	}
	preventive, err := s.Q.DayPreventiveIntakes(ctx, userID, dbDate(ymd))
	if err != nil {
		return nil, err
	}

	label := func(names ...*string) string {
		raw := "Medication"
		for _, n := range names {
			if n != nil {
				raw = *n
				break
			}
		}
		if t := jsx.Trim(raw); t != "" {
			return t
		}
		return "Medication"
	}
	type medRow struct {
		takenAt time.Time
		label   string
		dose    *string
		unit    *string
		obj     *httpx.Object
	}
	var merged []medRow
	for _, m := range intakes {
		l := label(m.MedicationName, m.CustomName, m.CanonicalName)
		merged = append(merged, medRow{m.TakenAt.Time, l, m.Dose, m.Unit, httpx.O(
			"id", "intake:"+m.ID, "takenAt", jsontime.Format(m.TakenAt.Time), "label", l,
			"dose", m.Dose, "unit", m.Unit, "unitIsCustom", m.UnitIsCustom)})
	}
	for _, m := range doses {
		l := label(nil, m.CustomName, m.CanonicalName)
		merged = append(merged, medRow{m.TakenAt.Time, l, m.Dose, m.Unit, httpx.O(
			"id", "acute:"+m.ID, "takenAt", jsontime.Format(m.TakenAt.Time), "label", l,
			"dose", m.Dose, "unit", m.Unit, "unitIsCustom", m.UnitIsCustom)})
	}
	seen := map[string]bool{}
	var deduped []medRow
	for _, m := range merged {
		key := jsontime.Format(m.takenAt)[:16] + "|" + strings.ToLower(m.label) + "|" + deref(m.dose) + "|" + deref(m.unit)
		if !seen[key] {
			seen[key] = true
			deduped = append(deduped, m)
		}
	}
	sort.SliceStable(deduped, func(i, j int) bool { return deduped[i].takenAt.Before(deduped[j].takenAt) })
	meds := make([]any, len(deduped))
	for i, m := range deduped {
		meds[i] = m.obj
	}

	atk := make([]any, len(attacks))
	for i, a := range attacks {
		var end any
		if a.EndTime != nil {
			end = jsontime.Format(a.EndTime.Time)
		}
		atk[i] = httpx.O("id", a.ID, "attackType", a.AttackType, "startTime", jsontime.Format(a.StartTime.Time),
			"endTime", end, "isOngoing", a.IsOngoing, "intensity", a.Intensity,
			"triggers", rawArray(a.Triggers), "protectors", rawArray(a.Protectors))
	}
	prev := make([]any, len(preventive))
	for i, p := range preventive {
		var taken any
		if p.TakenAt != nil {
			taken = jsontime.Format(p.TakenAt.Time)
		}
		prev[i] = httpx.O("id", p.ID, "planId", p.PlanID, "label", p.Name, "doseText", p.DoseText, "state", p.State, "takenAt", taken)
	}
	return httpx.O("timezone", zone, "entry", entry, "attacks", atk, "medicationIntakes", meds, "preventiveIntakes", prev), nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func rawArray(b json.RawMessage) any {
	if len(b) == 0 || string(b) == "null" {
		return []any{}
	}
	return b
}
