package jsx

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestFormatGolden compares with V8 (recorded by scripts/jsformat-golden.mts, now in git history).
func TestFormatGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/format.json")
	require.NoError(t, err)
	var g struct {
		ToFixed [][3]any
		Compare [][3]any
		Round   [][3]any
	}
	require.NoError(t, json.Unmarshal(raw, &g))
	for _, c := range g.ToFixed {
		require.Equal(t, c[2], ToFixed(c[0].(float64), int(c[1].(float64))), "%v.toFixed(%v)", c[0], c[1])
	}
	require.NotEmpty(t, g.Round)
	for _, c := range g.Round {
		got := Round(c[0].(float64))
		require.Equal(t, c[1].(float64), got, "Math.round(%v)", c[0])
		require.Equal(t, c[2].(bool), got == 0 && math.Signbit(got), "Math.round(%v) is -0", c[0])
	}
	for _, c := range g.Compare {
		got := LocaleCompare(c[0].(string), c[1].(string))
		if got > 0 {
			got = 1
		} else if got < 0 {
			got = -1
		}
		require.Equal(t, int(c[2].(float64)), got, "%q.localeCompare(%q)", c[0], c[1])
	}
}
