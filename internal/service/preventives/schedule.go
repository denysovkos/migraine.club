// Package preventives is src/services/preventives: preventive treatment
// plans, their schedules, adherence and outcome summaries.
package preventives

import (
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
)

// ForgivenessDays is PREVENTIVE_FORGIVENESS_DAYS.
const ForgivenessDays = 3

// maxEpochMilli bounds a valid Luxon DateTime.
const maxEpochMilli = 8.64e15

var specificDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// Plan is PreventiveSchedulePlan. Payload is the decoded schedule_payload.
type Plan struct {
	ID           string
	Kind         string
	ScheduleType string
	Payload      any
	StartDate    string
	Status       string
}

// DecodePayload decodes a jsonb schedule_payload like the pg driver did.
func DecodePayload(raw json.RawMessage) any {
	var v any
	if len(raw) == 0 || json.Unmarshal(raw, &v) != nil {
		return nil
	}
	return v
}

// IntakeEvent is PreventiveIntakeEventLite.
type IntakeEvent struct {
	LocalDate string
	State     string
}

// civil parses a valid YYYY-MM-DD as a calendar date. Luxon's day and week
// arithmetic on startOf('day') values is calendar arithmetic, so the zone
// does not change any result.
func civil(ymd string) time.Time {
	t, _ := time.Parse(localdate.Layout, ymd)
	return t
}

func ymd(t time.Time) string { return t.Format(localdate.Layout) }

func weekday(t time.Time) int {
	if wd := int(t.Weekday()); wd != 0 {
		return wd
	}
	return 7
}

func daysBetween(a, b time.Time) int { return int(b.Sub(a).Hours() / 24) }

func isInteger(f float64) bool { return !math.IsInf(f, 0) && math.Trunc(f) == f }

func parseWeekdays(payload any) []int {
	arr, ok := payload.([]any)
	if !ok {
		return nil
	}
	out := []int{}
	for _, v := range arr {
		f, ok := v.(float64)
		if ok && isInteger(f) && f >= 1 && f <= 7 && !slices.Contains(out, int(f)) {
			out = append(out, int(f))
		}
	}
	return out
}

func parseSpecificDates(payload any) []string {
	arr, ok := payload.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	for _, v := range arr {
		if s, ok := v.(string); ok && specificDateRe.MatchString(s) {
			out = append(out, s)
		}
	}
	return out
}

// parseEveryN returns n, or 0 for Luxon's null.
func parseEveryN(payload any) float64 {
	obj, ok := payload.(map[string]any)
	if !ok {
		return 0
	}
	n, ok := obj["n"].(float64)
	if !ok || !isInteger(n) || n <= 0 {
		return 0
	}
	return n
}

// window is a DueWindow; valid is false where Luxon produced an invalid
// DateTime, whose null dates never compare as in range.
type window struct {
	dueDate, start, end string
	valid               bool
}

func (w window) contains(d string) bool { return w.valid && d >= w.start && d <= w.end }

func windowFor(due time.Time, valid bool) window {
	half := ForgivenessDays / 2
	if !valid {
		return window{}
	}
	return window{ymd(due), ymd(due.AddDate(0, 0, -half)), ymd(due.AddDate(0, 0, half)), true}
}

// addWeeks is DateTime.plus({ weeks }); ok is false past Luxon's range.
func addWeeks(t time.Time, weeks float64) (time.Time, bool) {
	ms := float64(t.UnixMilli()) + weeks*7*86400000
	if math.Abs(ms) > maxEpochMilli {
		return time.Time{}, false
	}
	return t.AddDate(0, 0, int(weeks)*7), true
}

func everyNWeeksWindow(startDate, localDate string, n float64) (window, bool) {
	start, target := civil(startDate), civil(localDate)
	if target.Before(start) {
		return window{}, false
	}
	weeksDiff := math.Floor(float64(daysBetween(start, target)) / 7)
	kPrev := math.Floor(weeksDiff / n)
	prevDue, ok := addWeeks(start, kPrev*n)
	prev := windowFor(prevDue, ok)
	nextDue, ok2 := addWeeks(prevDue, n)
	next := windowFor(nextDue, ok && ok2)
	if prev.contains(localDate) {
		return prev, true
	}
	if next.contains(localDate) {
		return next, true
	}
	return prev, true
}

// ScheduleLabel is scheduleLabel.
func ScheduleLabel(p Plan) string {
	switch p.ScheduleType {
	case "daily":
		return "Daily"
	case "weekdays":
		return "Weekdays"
	case "custom_weekdays":
		wds := parseWeekdays(p.Payload)
		if len(wds) == 0 {
			return "Custom days"
		}
		slices.Sort(wds)
		labels := []string{"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}
		out := make([]string, len(wds))
		for i, d := range wds {
			out[i] = labels[d-1]
		}
		return strings.Join(out, ", ")
	case "every_n_days":
		if n := parseEveryN(p.Payload); n != 0 {
			return "Every " + jsx.FormatNumber(n) + " days"
		}
		return "Every N days"
	case "every_n_weeks":
		if n := parseEveryN(p.Payload); n != 0 {
			return "Every " + jsx.FormatNumber(n) + " weeks"
		}
		return "Every N weeks"
	case "on_specific_dates":
		return "Specific dates"
	default:
		return "Schedule"
	}
}

// IsDueOnDate is isDueOnDate.
func IsDueOnDate(p Plan, localDate string) bool {
	if localDate < p.StartDate {
		return false
	}
	day, start := civil(localDate), civil(p.StartDate)
	switch p.ScheduleType {
	case "daily":
		return true
	case "weekdays":
		return weekday(day) <= 5
	case "custom_weekdays":
		return slices.Contains(parseWeekdays(p.Payload), weekday(day))
	case "every_n_days":
		n := parseEveryN(p.Payload)
		if n == 0 {
			return false
		}
		return math.Mod(float64(daysBetween(start, day)), n) == 0
	case "every_n_weeks":
		n := parseEveryN(p.Payload)
		if n == 0 || weekday(day) != weekday(start) {
			return false
		}
		return math.Mod(math.Floor(float64(daysBetween(start, day))/7), n) == 0
	case "on_specific_dates":
		return slices.Contains(parseSpecificDates(p.Payload), localDate)
	default:
		return false
	}
}

func isWindowed(p Plan) bool {
	return p.ScheduleType == "every_n_weeks" && (p.Kind == "injection" || p.Kind == "infusion")
}

// DueStatus is getDueStatus's result.
type DueStatus struct {
	IsDue, IsOverdue bool
	DueLabel         string
	CanLogToday      bool
	MatchedEvent     *IntakeEvent
}

func findEvent(events []IntakeEvent, match func(string) bool) *IntakeEvent {
	for i := range events {
		if match(events[i].LocalDate) {
			return &events[i]
		}
	}
	return nil
}

// GetDueStatus is getDueStatus.
func GetDueStatus(p Plan, localDate string, events []IntakeEvent) DueStatus {
	st := DueStatus{DueLabel: ScheduleLabel(p), CanLogToday: p.Status != "stopped"}
	if localDate < p.StartDate {
		return st
	}
	if isWindowed(p) {
		n := parseEveryN(p.Payload)
		if n == 0 {
			return st
		}
		w, ok := everyNWeeksWindow(p.StartDate, localDate, n)
		if !ok {
			return st
		}
		st.IsDue = w.contains(localDate)
		st.MatchedEvent = findEvent(events, w.contains)
		st.IsOverdue = w.valid && localDate > w.end && st.MatchedEvent == nil
		return st
	}
	st.IsDue = IsDueOnDate(p, localDate)
	st.MatchedEvent = findEvent(events, func(d string) bool { return d == localDate })
	return st
}

// Adherence is resolveAdherenceForRange's result.
type Adherence struct {
	DueDays  int     `json:"dueDays"`
	Taken    int     `json:"taken"`
	Missed   int     `json:"missed"`
	Unsure   int     `json:"unsure"`
	Coverage float64 `json:"coverage"`
}

func (a *Adherence) count(e *IntakeEvent) {
	switch {
	case e == nil:
	case e.State == "taken":
		a.Taken++
	case e.State == "missed":
		a.Missed++
	default:
		a.Unsure++
	}
}

// ResolveAdherenceForRange is resolveAdherenceForRange.
func ResolveAdherenceForRange(p Plan, from, to string, events []IntakeEvent) Adherence {
	var a Adherence
	end := civil(to)
	for cur := civil(from); !cur.After(end); cur = cur.AddDate(0, 0, 1) {
		day := ymd(cur)
		if isWindowed(p) {
			n := parseEveryN(p.Payload)
			if n == 0 {
				continue
			}
			start := civil(p.StartDate)
			if cur.Before(start) || weekday(cur) != weekday(start) {
				continue
			}
			if math.Mod(math.Floor(float64(daysBetween(start, cur))/7), n) != 0 {
				continue
			}
			a.DueDays++
			if w, ok := everyNWeeksWindow(p.StartDate, day, n); ok {
				a.count(findEvent(events, w.contains))
			}
			continue
		}
		if !IsDueOnDate(p, day) {
			continue
		}
		a.DueDays++
		a.count(findEvent(events, func(d string) bool { return d == day }))
	}
	if a.DueDays > 0 {
		a.Coverage = float64(a.Taken+a.Missed+a.Unsure) / float64(a.DueDays)
	}
	return a
}
