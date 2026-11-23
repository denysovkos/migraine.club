package luxon

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/tz"
)

type golden struct {
	Input string  `json:"input"`
	Zone  string  `json:"zone"`
	Now   int64   `json:"now"`
	Valid bool    `json:"valid"`
	MS    *int64  `json:"ms"`
	Date  *string `json:"date"`
}

// TestFromISOGolden compares against real Luxon output
// (scripts/luxon-golden.mts).
func TestFromISOGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/fromiso.json")
	require.NoError(t, err)
	var cases []golden
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)
	for _, c := range cases {
		loc, ok := tz.Load(c.Zone)
		require.True(t, ok)
		got, valid := FromISO(c.Input, loc, time.UnixMilli(c.Now))
		require.Equal(t, c.Valid, valid, "%q in %s at %d", c.Input, c.Zone, c.Now)
		if !valid {
			continue
		}
		require.Equal(t, *c.MS, got.UnixMilli(), "%q in %s at %d", c.Input, c.Zone, c.Now)
		require.Equal(t, *c.Date, ISODate(got), "%q in %s at %d", c.Input, c.Zone, c.Now)
	}
}

// TestDiffDaysGolden compares DiffDays and PlusDays with Luxon
// (scripts/luxon-diff-golden.mts).
func TestDiffDaysGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/diffdays.json")
	require.NoError(t, err)
	var cases []struct {
		A, B         int64
		AZone, BZone string
		Days         float64
		PlusN        int
		Plus         int64
	}
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)
	for _, c := range cases {
		aLoc, _ := tz.Load(c.AZone)
		bLoc, _ := tz.Load(c.BZone)
		require.Equal(t, c.Days, DiffDays(time.UnixMilli(c.A), aLoc, time.UnixMilli(c.B), bLoc), "%+v", c)
		require.Equal(t, c.Plus, PlusDays(time.UnixMilli(c.A), aLoc, c.PlusN).UnixMilli(), "%+v", c)
	}
}

func TestToISO(t *testing.T) {
	berlin, _ := tz.Load("Europe/Berlin")
	kolkata, _ := tz.Load("Asia/Kolkata")
	ny, _ := tz.Load("America/New_York")
	at := time.Date(2026, 1, 15, 10, 4, 5, 123_456_789, time.UTC)
	// Values from luxon: DateTime.fromJSDate(at, { zone }).toISO()
	require.Equal(t, "2026-01-15T11:04:05.123+01:00", ToISO(at, berlin))
	require.Equal(t, "2026-01-15T15:34:05.123+05:30", ToISO(at, kolkata))
	require.Equal(t, "2026-01-15T05:04:05.123-05:00", ToISO(at, ny))
	require.Equal(t, "2026-01-15T10:04:05.123Z", ToISO(at, time.UTC))
}
