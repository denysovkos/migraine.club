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

func TestOwnKeysAndPropertyKey(t *testing.T) {
	require.Equal(t, []string{"1", "2", "10", "b", "a", "01"}, jsx.OwnKeys([]string{"b", "10", "a", "2", "01", "1"}))
	obj, _ := jsx.ParseJSON([]byte(`{"a":1}`))
	for in, want := range map[string]string{`null`: "null", `"x"`: "x", `true`: "true", `1.50`: "1.5", `[1,null,[2,"a"]]`: "1,,2,a", `{"a":1}`: "[object Object]"} {
		v, _ := jsx.ParseJSON([]byte(in))
		require.Equal(t, want, jsx.ToPropertyKey(v), in)
	}
	require.Equal(t, "[object Object]", jsx.ToPropertyKey(obj))
}

func TestJSONObjectMarshalJSON(t *testing.T) {
	o := jsx.NewJSONObject().Set("b", 1.0).Set("1", []any{"x", nil})
	b, err := json.Marshal(map[string]any{"o": o})
	require.NoError(t, err)
	require.JSONEq(t, `{"o":{"1":["x",null],"b":1}}`, string(b))
}
