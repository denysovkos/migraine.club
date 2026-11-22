package jsx

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestFormatGolden compares with V8 (scripts/jsformat-golden.mts).
func TestFormatGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/format.json")
	require.NoError(t, err)
	var g struct {
		ToFixed [][3]any
		Compare [][3]any
	}
	require.NoError(t, json.Unmarshal(raw, &g))
	for _, c := range g.ToFixed {
		require.Equal(t, c[2], ToFixed(c[0].(float64), int(c[1].(float64))), "%v.toFixed(%v)", c[0], c[1])
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
