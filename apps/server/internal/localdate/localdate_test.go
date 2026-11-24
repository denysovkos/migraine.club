package localdate

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func mustUTC(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestStringAcrossMidnightAndDST(t *testing.T) {
	// 23:30Z on Mar 30 is 00:30 local on Mar 31 (CET->CEST weekend).
	require.Equal(t, "2024-03-31", String(mustUTC("2024-03-30T23:30:00Z"), "Europe/Berlin"))
	require.Equal(t, "2024-10-27", String(mustUTC("2024-10-26T23:30:00Z"), "Europe/Berlin"))
	require.Equal(t, "2024-03-30", String(mustUTC("2024-03-30T23:30:00Z"), "Not/AZone"))
	require.Equal(t, "2024-03-30T00:00:00Z", DBDate(mustUTC("2024-03-30T12:00:00Z"), "UTC").Format(time.RFC3339))
}

func TestEditWindow(t *testing.T) {
	now := mustUTC("2026-01-06T12:00:00Z") // 13:00 in Berlin
	require.True(t, IsEditable("2026-01-06", now, "Europe/Berlin"))
	require.True(t, IsEditable("2025-12-08", now, "Europe/Berlin"))  // today - 29
	require.False(t, IsEditable("2025-12-07", now, "Europe/Berlin")) // today - 30
	require.False(t, IsEditable("2026-01-07", now, "Europe/Berlin"))
	require.False(t, IsEditable("2026-01-06", now, "Bad/Zone"))
	require.False(t, IsEditable("06.01.2026", now, "Europe/Berlin"))
}

func ptr(t time.Time) *time.Time { return &t }

func TestOverlapped(t *testing.T) {
	s := mustUTC("2024-01-01T23:00:00Z")
	require.Equal(t, []string{"2024-01-01"}, Overlapped(s, nil, "UTC"))
	require.Equal(t, []string{"2024-01-01", "2024-01-02"}, Overlapped(s, ptr(mustUTC("2024-01-02T01:00:00Z")), "UTC"))
	// Ending exactly at midnight does not touch the next day.
	require.Equal(t, []string{"2024-01-01"}, Overlapped(s, ptr(mustUTC("2024-01-02T00:00:00Z")), "UTC"))
	// End before start is the start day only.
	require.Equal(t, []string{"2024-01-01"}, Overlapped(s, ptr(mustUTC("2024-01-01T10:00:00Z")), "UTC"))
	// The same instant is a different day in Berlin.
	require.Equal(t, []string{"2024-01-02"}, Overlapped(s, nil, "Europe/Berlin"))
	// Across the spring DST change.
	require.Equal(t, []string{"2024-03-30", "2024-03-31", "2024-04-01"},
		Overlapped(mustUTC("2024-03-30T12:00:00Z"), ptr(mustUTC("2024-04-01T08:00:00Z")), "Europe/Berlin"))
}

func TestUTCRange(t *testing.T) {
	a, b := UTCRange("Europe/Berlin", []string{"2024-03-31", "2024-03-30"})
	require.Equal(t, "2024-03-29T23:00:00Z", a.Format(time.RFC3339))
	require.Equal(t, "2024-03-31T22:00:00Z", b.Format(time.RFC3339))
}
