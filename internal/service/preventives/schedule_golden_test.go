package preventives

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

type goldenCase struct {
	Plan struct {
		ID, Kind, ScheduleType, StartDate, Status string
		SchedulePayload                           json.RawMessage
	}
	Events []IntakeEvent
	Label  string
	Checks []struct {
		LocalDate                                  string
		IsDueOnDate, IsDue, IsOverdue, CanLogToday bool
		Matched                                    int
	}
	From, To  string
	Adherence Adherence
	Windows   Windows
}

// TestScheduleGolden runs the TS schedule functions' recorded results
// (recorded by scripts/preventives-golden.mts, now in git history) against the Go port.
func TestScheduleGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/schedule.json")
	require.NoError(t, err)
	var cases []goldenCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.Len(t, cases, 600)
	for _, c := range cases {
		p := Plan{ID: c.Plan.ID, Kind: c.Plan.Kind, ScheduleType: c.Plan.ScheduleType,
			Payload: DecodePayload(c.Plan.SchedulePayload), StartDate: c.Plan.StartDate, Status: c.Plan.Status}
		msg := c.Plan.ID
		require.Equal(t, c.Label, ScheduleLabel(p), msg)
		for _, ch := range c.Checks {
			require.Equal(t, ch.IsDueOnDate, IsDueOnDate(p, ch.LocalDate), "%s %s", msg, ch.LocalDate)
			s := GetDueStatus(p, ch.LocalDate, c.Events)
			require.Equal(t, ch.IsDue, s.IsDue, "%s %s isDue", msg, ch.LocalDate)
			require.Equal(t, ch.IsOverdue, s.IsOverdue, "%s %s isOverdue", msg, ch.LocalDate)
			require.Equal(t, ch.CanLogToday, s.CanLogToday, msg)
			matched := -1
			for i := range c.Events {
				if s.MatchedEvent == &c.Events[i] {
					matched = i
				}
			}
			require.Equal(t, ch.Matched, matched, "%s %s matched", msg, ch.LocalDate)
		}
		require.Equal(t, c.Adherence, ResolveAdherenceForRange(p, c.From, c.To, c.Events), msg)
		require.Equal(t, c.Windows, ResolvePlanWindows(p.StartDate, c.To), msg)
	}
}
