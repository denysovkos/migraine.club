package jsx

import (
	"encoding/json"
	"math"
	"os"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

func goldenNum(t *testing.T, v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		switch x {
		case "Infinity":
			return math.Inf(1)
		case "-Infinity":
			return math.Inf(-1)
		case "NaN":
			return math.NaN()
		case "-0":
			return math.Copysign(0, -1)
		}
	}
	t.Fatalf("bad golden value %v", v)
	return 0
}

// TestFdlibmGolden checks bit-exact agreement with V8
// (scripts/fdlibm-golden.mts).
func TestFdlibmGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/fdlibm.json")
	require.NoError(t, err)
	var g struct{ Log, Exp [][2]any }
	require.NoError(t, json.Unmarshal(raw, &g))
	require.NotEmpty(t, g.Log)
	check := func(name string, fn func(float64) float64, cases [][2]any) {
		for _, c := range cases {
			in, want := goldenNum(t, c[0]), goldenNum(t, c[1])
			got := fn(in)
			if math.IsNaN(want) {
				require.True(t, math.IsNaN(got), "%s(%v)", name, in)
				continue
			}
			require.Equal(t, math.Float64bits(want), math.Float64bits(got), "%s(%s) = %v, want %v", name, strconv.FormatFloat(in, 'g', -1, 64), got, want)
		}
	}
	check("log", Log, g.Log)
	check("exp", Exp, g.Exp)
}
