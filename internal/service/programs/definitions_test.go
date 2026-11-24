package programs

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/httpx"
)

// TestDefinitionsGolden checks the embedded definitions against what the TS
// loader parsed (recorded by scripts/programs-golden.mts, now in git history): order, the Zod-ordered
// frontmatter fields the API returns, and localized bodies.
func TestDefinitionsGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/definitions.json")
	require.NoError(t, err)
	var golden []struct {
		Frontmatter struct {
			ID                     string            `json:"id"`
			Title                  string            `json:"title"`
			DefaultTarget          json.RawMessage   `json:"defaultTarget"`
			Citations              []json.RawMessage `json:"citations"`
			RecommendationTriggers json.RawMessage   `json:"recommendationTriggers"`
		} `json:"frontmatter"`
		Bodies map[string]string `json:"bodies"`
	}
	require.NoError(t, json.Unmarshal(raw, &golden))
	defs := Definitions()
	require.Len(t, defs, len(golden))
	for i, g := range golden {
		d := defs[i]
		require.Equal(t, g.Frontmatter.ID, d.ID)
		require.Equal(t, g.Frontmatter.Title, d.Title)
		require.Equal(t, string(g.Frontmatter.DefaultTarget), string(d.DefaultTarget))
		require.Len(t, d.Citations, len(g.Frontmatter.Citations))
		for j := range d.Citations {
			require.Equal(t, string(g.Frontmatter.Citations[j]), string(d.Citations[j]))
		}
		var triggers []Trigger
		require.NoError(t, json.Unmarshal(g.Frontmatter.RecommendationTriggers, &triggers))
		require.Equal(t, triggers, d.Triggers)
		for locale, body := range g.Bodies {
			require.Equal(t, body, d.BodyFor(locale), "%s %q", d.ID, locale)
		}
		_, err := httpx.Marshal(d.Citations)
		require.NoError(t, err)
	}
}
