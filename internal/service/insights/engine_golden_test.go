package insights

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/httpx"
)

type goldenCase struct {
	UserID       string `json:"userId"`
	Now          int64  `json:"now"`
	Zone         string `json:"zone"`
	WindowDays   int    `json:"windowDays"`
	MinDiaryDays int    `json:"minDiaryDays"`
	Episodes     []struct {
		ID      int32  `json:"id"`
		Start   int64  `json:"start"`
		End     *int64 `json:"end"`
		Ongoing bool   `json:"ongoing"`
	} `json:"episodes"`
	Factors []struct {
		ID          string `json:"id"`
		DisplayName string `json:"displayName"`
		Type        string `json:"type"`
	} `json:"factors"`
	Events []struct {
		FactorID string `json:"factorId"`
		At       int64  `json:"at"`
	} `json:"events"`
	Diary   []string        `json:"diary"`
	Status  string          `json:"status"`
	Reason  string          `json:"reason"`
	Payload json.RawMessage `json:"payload"`
}

// TestEngineGolden compares byte for byte with computeInsightsForUser's
// payloads (scripts/insights-golden.mts), runtimeMs zeroed.
func TestEngineGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/engine.json")
	require.NoError(t, err)
	var cases []goldenCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.Len(t, cases, 160)
	fixed := time.Unix(0, 0)
	for i, c := range cases {
		cfg := DefaultConfig
		cfg.WindowDays, cfg.MinDiaryDays = c.WindowDays, c.MinDiaryDays
		var eps []Episode
		for _, e := range c.Episodes {
			eps = append(eps, Episode{ID: e.ID, StartMs: e.Start, EndMs: e.End, IsOngoing: e.Ongoing})
		}
		var fs []Factor
		for _, f := range c.Factors {
			fs = append(fs, Factor{f.ID, f.DisplayName, f.Type})
		}
		var evs []FactorEvent
		for _, e := range c.Events {
			evs = append(evs, FactorEvent{e.FactorID, e.At})
		}
		res := Compute(c.UserID, time.UnixMilli(c.Now), cfg, eps, fs, evs, c.Diary, c.Zone, func() time.Time { return fixed })
		require.Equal(t, c.Status, res.Status, "case %d", i)
		require.Equal(t, c.Reason, res.Reason, "case %d", i)
		got, err := httpx.Marshal(res.Payload)
		require.NoError(t, err)
		if want := string(c.Payload); want != string(got) {
			at := 0
			for at < len(want) && at < len(got) && want[at] == got[at] {
				at++
			}
			from := max(0, at-200)
			t.Fatalf("case %d (%s, %s) differs at %d:\nwant …%s\ngot  …%s", i, c.Zone, c.Status, at,
				want[from:min(len(want), at+120)], string(got[from:min(len(got), at+120)]))
		}
	}
}
