package preventives

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Ported from schedule.test.ts, adherence.test.ts and metrics.test.ts.

func basePlan(mod func(*Plan)) Plan {
	p := Plan{ID: "plan-1", Kind: "oral", ScheduleType: "daily", StartDate: "2025-01-01", Status: "active"}
	if mod != nil {
		mod(&p)
	}
	return p
}

func TestDailyDueAfterStart(t *testing.T) {
	p := basePlan(nil)
	require.True(t, IsDueOnDate(p, "2025-01-01"))
	require.True(t, IsDueOnDate(p, "2025-01-02"))
	require.False(t, IsDueOnDate(p, "2024-12-31"))
}

func TestWeekdaysExcludesWeekends(t *testing.T) {
	p := basePlan(func(p *Plan) { p.ScheduleType = "weekdays" })
	require.True(t, IsDueOnDate(p, "2025-01-03"))
	require.False(t, IsDueOnDate(p, "2025-01-04"))
}

func TestCustomWeekdays(t *testing.T) {
	p := basePlan(func(p *Plan) { p.ScheduleType = "custom_weekdays"; p.Payload = []any{1.0, 3.0, 5.0} })
	require.True(t, IsDueOnDate(p, "2025-01-06"))
	require.False(t, IsDueOnDate(p, "2025-01-07"))
	require.Equal(t, "Mon, Wed, Fri", ScheduleLabel(p))
}

func TestEveryNDays(t *testing.T) {
	p := basePlan(func(p *Plan) { p.ScheduleType = "every_n_days"; p.Payload = map[string]any{"n": 2.0} })
	require.True(t, IsDueOnDate(p, "2025-01-01"))
	require.False(t, IsDueOnDate(p, "2025-01-02"))
	require.True(t, IsDueOnDate(p, "2025-01-03"))
	require.Equal(t, "Every 2 days", ScheduleLabel(p))
}

func TestEveryNWeeksOnStartWeekday(t *testing.T) {
	p := basePlan(func(p *Plan) { p.ScheduleType = "every_n_weeks"; p.Payload = map[string]any{"n": 2.0} })
	require.True(t, IsDueOnDate(p, "2025-01-01"))
	require.False(t, IsDueOnDate(p, "2025-01-08"))
	require.True(t, IsDueOnDate(p, "2025-01-15"))
}

func TestOnSpecificDates(t *testing.T) {
	p := basePlan(func(p *Plan) { p.ScheduleType = "on_specific_dates"; p.Payload = []any{"2025-01-02", "2025-01-10"} })
	require.True(t, IsDueOnDate(p, "2025-01-02"))
	require.False(t, IsDueOnDate(p, "2025-01-03"))
}

func TestInjectionDueWithinWindow(t *testing.T) {
	p := basePlan(func(p *Plan) {
		p.Kind = "injection"
		p.ScheduleType = "every_n_weeks"
		p.Payload = map[string]any{"n": 4.0}
	})
	require.True(t, GetDueStatus(p, "2025-01-02", nil).IsDue)
}

func TestInfusionOverdueOnlyAfterWindow(t *testing.T) {
	p := basePlan(func(p *Plan) {
		p.Kind = "infusion"
		p.ScheduleType = "every_n_weeks"
		p.Payload = map[string]any{"n": 4.0}
	})
	require.Equal(t, 3, ForgivenessDays)
	require.True(t, GetDueStatus(p, "2025-01-05", nil).IsOverdue)
	require.False(t, GetDueStatus(p, "2025-01-05", []IntakeEvent{{"2025-01-02", "taken"}}).IsOverdue)
}

func TestAdherenceExcludesUnsureFromDenominator(t *testing.T) {
	a := ResolveAdherenceForRange(basePlan(nil), "2025-01-01", "2025-01-03", []IntakeEvent{
		{"2025-01-01", "taken"}, {"2025-01-02", "unsure"}, {"2025-01-03", "missed"},
	})
	require.Equal(t, Adherence{DueDays: 3, Taken: 1, Missed: 1, Unsure: 1, Coverage: 1}, a)
}

func TestAdherenceIgnoresNonDueDays(t *testing.T) {
	p := basePlan(func(p *Plan) { p.ScheduleType = "custom_weekdays"; p.Payload = []any{1.0} })
	a := ResolveAdherenceForRange(p, "2025-01-01", "2025-01-07", []IntakeEvent{{"2025-01-02", "taken"}, {"2025-01-06", "taken"}})
	require.Equal(t, 1, a.DueDays)
	require.Equal(t, 1, a.Taken)
}

func TestResolvePlanWindows(t *testing.T) {
	w := ResolvePlanWindows("2025-01-15", "2025-03-01")
	require.Equal(t, "2024-12-18", w.BaselineFrom)
	require.Equal(t, "2025-01-14", w.BaselineTo)
	require.Equal(t, "2025-01-29", w.EvalFrom)
	require.Equal(t, "2025-02-25", w.EvalTo)
	require.Equal(t, "2025-02-25", w.EvalEnd)

	w = ResolvePlanWindows("2025-01-15", "2025-02-05")
	require.Equal(t, "2025-02-05", w.EvalEnd)
	require.True(t, w.HasEvalData)
}
