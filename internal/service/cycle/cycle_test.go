package cycle

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func ip(v int) *int       { return &v }
func sp(v string) *string { return &v }

func TestStartDates(t *testing.T) {
	days := map[string]bool{"2026-01-01": true, "2026-01-02": true, "2026-01-03": true, "2026-01-29": true, "2026-01-30": true}
	require.Equal(t, []string{"2026-01-01", "2026-01-29"}, BleedingStartDates(days))
	require.Equal(t, []string{}, BleedingStartDates(map[string]bool{}))
}

func TestCycleAndRelativeDays(t *testing.T) {
	require.Nil(t, CycleDay("2026-01-10", nil))
	require.Nil(t, CycleDay("2026-01-01", sp("2026-01-05")))
	require.Equal(t, ip(1), CycleDay("2026-01-05", sp("2026-01-05")))
	require.Equal(t, ip(6), CycleDay("2026-01-10", sp("2026-01-05")))
	// Across a DST change the day count stays whole.
	require.Equal(t, 30, DiffInDays("2026-03-01", "2026-03-31"))

	require.True(t, InWindow("2026-01-03", sp("2026-01-05"), -2, 3))
	require.True(t, InWindow("2026-01-08", sp("2026-01-05"), -2, 3))
	require.False(t, InWindow("2026-01-09", sp("2026-01-05"), -2, 3))
	require.False(t, InWindow("2026-01-09", nil, -2, 3))
}

func TestNearestAndHistogram(t *testing.T) {
	starts := []string{"2026-01-01", "2026-01-29"}
	require.Equal(t, "2026-01-01", *NearestStart("2026-01-14", starts))
	require.Equal(t, "2026-01-01", *NearestStart("2026-01-15", starts), "ties keep the first")
	require.Equal(t, "2026-01-29", *NearestStart("2026-01-16", starts))
	require.Nil(t, NearestStart("2026-01-16", nil))

	h := Histogram([]string{"2025-12-30", "2026-01-01", "2026-01-02", "2026-01-20"}, starts, -5, 7)
	require.Len(t, h, 13)
	b, _ := marshal(h)
	require.Contains(t, b, `{"relativeDay":-2,"count":1}`)
	require.Contains(t, b, `{"relativeDay":0,"count":1}`)
	require.Contains(t, b, `{"relativeDay":1,"count":1}`)
}

func TestNormalizeDate(t *testing.T) {
	v, err := NormalizeDate("2026-01-05")
	require.NoError(t, err)
	require.Equal(t, "2026-01-05", v)
	v, err = NormalizeDate("2026-01-05T23:30:00-02:00")
	require.NoError(t, err)
	require.Equal(t, "2026-01-06", v)
	_, err = NormalizeDate("nope")
	require.ErrorIs(t, err, ErrInvalidDate)
}

func marshal(v any) (string, error) {
	b, err := httpxMarshal(v)
	return string(b), err
}
