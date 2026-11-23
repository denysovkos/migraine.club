package httpx

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestJSONSyntaxMessageGolden compares against V8 (scripts/json-syntax-golden.mts).
func TestJSONSyntaxMessageGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/json_syntax.json")
	require.NoError(t, err)
	var cases []struct{ Input, Message string }
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)
	for _, c := range cases {
		require.Equal(t, c.Message, JSONSyntaxMessage(c.Input), "%q", c.Input)
	}
}
