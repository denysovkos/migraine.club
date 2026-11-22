package profile

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// Names generated for the same seeds by the TypeScript implementation.
func TestDisplayNameFromSeedMatchesTypeScript(t *testing.T) {
	raw, err := os.ReadFile("testdata/names.json")
	require.NoError(t, err)
	var cases [][2]string
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)
	for _, c := range cases {
		require.Equal(t, c[1], DisplayNameFromSeed(c[0]), c[0])
	}
}

func TestDetectPreferredLanguage(t *testing.T) {
	require.Equal(t, "uk", DetectPreferredLanguage("uk-UA", ""))
	require.Equal(t, "fr", DetectPreferredLanguage("de", "de-DE,fr;q=0.8,en;q=0.5"))
	require.Equal(t, "en", DetectPreferredLanguage("", "de-DE,es"))
	require.Equal(t, "en", DetectPreferredLanguage("", ""))
	require.Equal(t, "fr", DetectPreferredLanguage("FR-ca", ""))
}

func TestDeriveDisplayName(t *testing.T) {
	require.Equal(t, "Ada Lovelace", DeriveDisplayName("u", "Ada", "Lovelace", ""))
	require.Equal(t, "Ad", DeriveDisplayName("u", "Ad", "", ""))
	require.Equal(t, "neo", DeriveDisplayName("u", "A", "", "neo"))
	require.Equal(t, DisplayNameFromSeed("u"), DeriveDisplayName("u", "", "", "x"))
	long := "Abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabc"
	require.Equal(t, long[:50], DeriveDisplayName("u", long, "", ""))
}

func TestDisplayNameValidation(t *testing.T) {
	require.False(t, IsValidDisplayName(""))
	require.False(t, IsValidDisplayName("  a  "))
	require.True(t, IsValidDisplayName(" ab "))
	require.Equal(t, "ab", SanitizeDisplayName("  ab  "))
}
