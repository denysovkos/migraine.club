package jobs_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/service/jobs"
	"github.com/denysovkos/migraine.club/internal/service/pressure"
)

var berlin, _ = time.LoadLocation("Europe/Berlin")

func at(h, m int) time.Time { return time.Date(2026, 3, 18, h, m, 0, 0, berlin) }

func TestIsSlotDue(t *testing.T) {
	now := at(8, 30)
	require.True(t, jobs.IsSlotDue(now, berlin, "08:30", 90))
	require.True(t, jobs.IsSlotDue(now, berlin, "07:00", 90))
	require.False(t, jobs.IsSlotDue(now, berlin, "06:59", 90), "more than 90 minutes late")
	require.False(t, jobs.IsSlotDue(now, berlin, "08:31", 90), "not yet")
	require.True(t, jobs.IsSlotDue(now, berlin, "08:", 90), "Number('') is 0")
	require.False(t, jobs.IsSlotDue(now, berlin, "8", 90))
	require.False(t, jobs.IsSlotDue(now, berlin, "x:00", 90))
}

func TestReminderBody(t *testing.T) {
	dose := " 50 mg "
	blank := "  "
	require.Equal(t, "50 mg · 08:00", jobs.ReminderBody(&dose, "08:00"))
	require.Equal(t, "Scheduled for 08:00", jobs.ReminderBody(&blank, "08:00"))
	require.Equal(t, "Scheduled for 08:00", jobs.ReminderBody(nil, "08:00"))
}

func TestFireWindowAndOnset(t *testing.T) {
	now := at(22, 0)
	require.True(t, jobs.IsWithinFireWindow(now, berlin, "22:30", -30))
	require.True(t, jobs.IsWithinFireWindow(now, berlin, "22:36", -30))
	require.False(t, jobs.IsWithinFireWindow(now, berlin, "22:37", -30))
	require.True(t, jobs.IsWithinFireWindow(now, berlin, "21:30", 30))
	onset := now.Add(-33 * time.Minute)
	require.True(t, jobs.IsOnsetNudgeDue(now, onset, 30, 6))
	require.False(t, jobs.IsOnsetNudgeDue(now, now.Add(-29*time.Minute), 30, 6))
	require.False(t, jobs.IsOnsetNudgeDue(now, now.Add(-37*time.Minute), 30, 6))
	require.True(t, jobs.ShouldSuppressForMoh("approaching"))
	require.False(t, jobs.ShouldSuppressForMoh("ok"))
}

func TestQuietHours(t *testing.T) {
	require.False(t, jobs.IsNotBetween8pmAnd9am(at(8, 59)))
	require.True(t, jobs.IsNotBetween8pmAnd9am(at(9, 0)))
	require.True(t, jobs.IsNotBetween8pmAnd9am(at(19, 59)))
	require.False(t, jobs.IsNotBetween8pmAnd9am(at(20, 0)))
}

func TestFutureMaxKp(t *testing.T) {
	now := time.Date(2026, 3, 18, 12, 0, 0, 0, time.UTC)
	raw := map[string]any{"raw": map[string]any{
		"datetime": []any{"2026-03-18T09:00:00Z", "2026-03-18T15:00:00Z", "2026-03-18T18:00:00Z", "bad", "2026-03-18T21:00:00Z"},
		"Kp":       []any{9.0, 6.333, "6.333", 9.0, nil},
	}}
	kp, ts, ok := jobs.FutureMaxKp(raw, now)
	require.True(t, ok)
	require.InDelta(t, 6.333, kp, 0)
	require.Equal(t, time.Date(2026, 3, 18, 15, 0, 0, 0, time.UTC), ts, "the earliest of equal maxima")
	_, _, ok = jobs.FutureMaxKp(map[string]any{"datetime": []any{"x"}, "Kp": []any{}}, now)
	require.False(t, ok)
}

func TestFindUpcomingDrop(t *testing.T) {
	days := pressure.BuildOutlook(nil, "UTC", 5, "2026-03-18", 6)
	require.Nil(t, pressure.FindUpcomingDrop(days, "2026-03-18", 2))
}
