package episodes

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
)

func at(s string) time.Time { t, _ := time.Parse(time.RFC3339, s); return t }
func sp(s string) *string  { return &s }

func TestResolveEndNowTime(t *testing.T) {
	start, now := at("2026-03-10T10:00:00Z"), at("2026-03-10T12:00:00Z")
	require.Equal(t, now, ResolveEndNowTime(nil, start, now))
	require.Equal(t, at("2026-03-10T11:00:00Z"), ResolveEndNowTime(sp("2026-03-10T11:00:00Z"), start, now))
	require.Equal(t, start, ResolveEndNowTime(sp("2026-03-10T09:00:00Z"), start, now))
	require.Equal(t, now, ResolveEndNowTime(sp("2026-03-10T13:00:00Z"), start, now))
	require.Equal(t, now, ResolveEndNowTime(sp("garbage"), start, now))
}

func TestAttackWindowAndReadingTime(t *testing.T) {
	ep := q.Episode{StartTime: jsontime.New(at("2026-03-10T10:00:00Z")), OnsetAt: jsontime.Ptr(at("2026-03-10T09:00:00Z")),
		EndTime: jsontime.Ptr(at("2026-03-11T02:00:00Z"))}
	w := WindowOf(ep)
	require.Equal(t, at("2026-03-10T09:00:00Z"), w.Start)
	require.Equal(t, at("2026-03-11T02:00:00Z"), *w.End)

	ep.OnsetAt = jsontime.Ptr(at("2026-03-10T11:00:00Z"))
	ep.IsOngoing = true
	w = WindowOf(ep)
	require.Equal(t, at("2026-03-10T10:00:00Z"), w.Start)
	require.Nil(t, w.End)

	now := at("2026-03-11T00:00:00Z")
	require.Equal(t, "", CheckReadingTime(at("2026-03-10T23:59:00Z"), w, now))
	require.Equal(t, "before_start", CheckReadingTime(at("2026-03-10T09:59:59Z"), w, now))
	require.Equal(t, "", CheckReadingTime(now.Add(4*time.Minute), w, now))
	require.Equal(t, "in_future", CheckReadingTime(now.Add(6*time.Minute), w, now))
	end := at("2026-03-10T12:00:00Z")
	require.Equal(t, "after_end", CheckReadingTime(at("2026-03-10T12:00:01Z"), AttackWindow{Start: w.Start, End: &end}, now))
}

func TestMidnightsBetween(t *testing.T) {
	got := MidnightsBetween(at("2026-03-10T20:00:00Z"), at("2026-03-12T01:00:00Z"), "Europe/Berlin")
	require.Equal(t, []time.Time{at("2026-03-10T23:00:00Z"), at("2026-03-11T23:00:00Z")}, utc(got))
	require.Empty(t, MidnightsBetween(at("2026-03-10T10:00:00Z"), at("2026-03-10T12:00:00Z"), "UTC"))
	require.Empty(t, MidnightsBetween(at("2026-03-10T10:00:00Z"), at("2026-03-10T09:00:00Z"), "UTC"))
	require.Equal(t, []time.Time{at("2026-03-11T00:00:00Z")}, utc(MidnightsBetween(at("2026-03-10T10:00:00Z"), at("2026-03-11T10:00:00Z"), "Nope/Zone")))
	require.Len(t, MidnightsBetween(at("2026-01-01T00:00:00Z"), at("2026-12-31T00:00:00Z"), "UTC"), 60)
}

func utc(ts []time.Time) []time.Time {
	out := make([]time.Time, len(ts))
	for i, t := range ts {
		out[i] = t.UTC()
	}
	return out
}

func TestFilterAllowed(t *testing.T) {
	require.Equal(t, []string{"NAUSEA"}, FilterAllowed([]byte(`["NAUSEA","BOGUS",3]`), Symptoms))
	require.Equal(t, []string{}, FilterAllowed(nil, Symptoms))
	require.Equal(t, "OTHER", AsPainLocation("NOSE"))
	require.Equal(t, "LEFT", AsPainLocation("LEFT"))
	require.Equal(t, "OTHER", AsPainType("x"))
}
