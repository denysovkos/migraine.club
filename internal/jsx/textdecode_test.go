package jsx_test

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

// Goldens from scripts/text-decode-golden.mts (V8).
func TestTextDecodeGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/textdecode.json")
	require.NoError(t, err)
	var g struct {
		Decode []struct{ Hex, Strip, Keep string }
		URI    []struct {
			In, Out string
			Err     bool
		}
	}
	require.NoError(t, json.Unmarshal(raw, &g))
	require.NotEmpty(t, g.Decode)
	for _, c := range g.Decode {
		b, _ := hex.DecodeString(c.Hex)
		require.Equal(t, c.Strip, jsx.UTF8Decode(b, true), c.Hex)
		require.Equal(t, c.Keep, jsx.UTF8Decode(b, false), c.Hex)
	}
	for _, c := range g.URI {
		out, err := jsx.DecodeURIComponent(c.In)
		require.Equal(t, c.Err, err != nil, c.In)
		require.Equal(t, c.Out, out, c.In)
	}
}
