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
