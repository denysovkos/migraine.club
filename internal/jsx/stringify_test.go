package jsx_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

// Goldens from scripts/json-stringify-golden.mts (V8).
func TestRestringifyGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/stringify.json")
	require.NoError(t, err)
	var cases []struct{ Input, Compact, Indented string }
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)
	for _, c := range cases {
		got, err := jsx.Restringify([]byte(c.Input), "")
		require.NoError(t, err, c.Input)
		require.Equal(t, c.Compact, string(got), c.Input)
		got, err = jsx.Restringify([]byte(c.Input), "  ")
		require.NoError(t, err, c.Input)
		require.Equal(t, c.Indented, string(got), c.Input)
	}
}

func TestRestringifyRejectsInvalid(t *testing.T) {
	for _, in := range []string{"", "{", `{"a":}`, "[1,]x", `"abc`, "1 2", `{"a" 1}`} {
		_, err := jsx.Restringify([]byte(in), "")
		require.Error(t, err, in)
	}
}

func TestQuoteJSON(t *testing.T) {
	require.Equal(t, "\"a \\n\\u0000\"", jsx.QuoteJSON("a \n\x00"))
}
