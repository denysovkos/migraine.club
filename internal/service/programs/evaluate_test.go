package programs

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Mirrors recommendationEngine.test.ts "factor-frequency counts days, not
// events" (the bug fix: many logs on few days used to qualify).
func TestFactorFrequencyCountsDistinctDays(t *testing.T) {
	trig := Trigger{Kind: "factor-frequency", Factor: "sleep_issue", Values: []string{}, MinDays: 5, WindowDays: 14}
	logs := func(days ...float64) Signals {
		var s Signals
		for _, d := range days {
			s.FactorLogs = append(s.FactorLogs, FactorLog{Factor: "sleep_issue", DaysAgo: d})
		}
		return s
	}
	require.Empty(t, evaluate(trig, logs(0, 0, 0, 1, 1, 2, 2, 3)))
	require.Equal(t, "Logged sleep_issue 6 of last 14 days.", evaluate(trig, logs(0, 0, 1, 2, 3, 4, 13, 14, 15)))
}
