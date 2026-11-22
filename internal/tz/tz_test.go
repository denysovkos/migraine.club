package tz

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLoad(t *testing.T) {
	for _, ok := range []string{"Europe/Berlin", "America/New_York", "UTC", "utc", "UTC+2", "UTC-05:30"} {
		require.True(t, Valid(ok), ok)
	}
	for _, bad := range []string{"", "Local", "Mars/Olympus", "Europe/Nowhere"} {
		require.False(t, Valid(bad), bad)
	}
	loc, _ := Load("UTC-05:30")
	_, off := time.Date(2026, 1, 1, 0, 0, 0, 0, loc).Zone()
	require.Equal(t, -(5*3600 + 30*60), off)
}
