package wpi

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestComputeMatchesTypeScript(t *testing.T) {
	raw, err := os.ReadFile("testdata/golden.json")
	require.NoError(t, err)
	var cases []struct {
		Input struct {
			DeltaPressure, TemperatureDeviation, Humidity, WindSpeed, Uvi float64
			KpIndex                                                       *float64
		}
		Output struct {
			Score      float64
			Level      string
			Components Components
		}
	}
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.Greater(t, len(cases), 500)
	for _, c := range cases {
		in := c.Input
		got := Compute(Weather{in.DeltaPressure, in.TemperatureDeviation, in.Humidity, in.WindSpeed, in.Uvi}, in.KpIndex)
		require.Equal(t, c.Output.Score, got.Score, "%+v", in)
		require.Equal(t, c.Output.Level, got.Level)
		require.Equal(t, c.Output.Components, got.Components)
	}
}

func TestLevelBoundaries(t *testing.T) {
	for s, want := range map[float64]string{0: "low", 2.4: "low", 2.5: "moderate", 4.9: "moderate", 5: "high", 7.4: "high", 7.5: "very_high", 10: "very_high"} {
		require.Equal(t, want, Level(s), s)
	}
}

func TestShouldRecomputeForKp(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	require.False(t, ShouldRecomputeForKp(f(3), nil))
	require.True(t, ShouldRecomputeForKp(nil, f(3)))
	require.False(t, ShouldRecomputeForKp(f(3), f(3.0000001)))
	require.True(t, ShouldRecomputeForKp(f(3), f(3.1)))
}
