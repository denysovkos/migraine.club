package jsx_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

type sortItem struct {
	ID int `json:"id"`
	V  any `json:"v"`
}

// Goldens recorded from V8 by scripts/js-sort-golden.mts (now in git history).
func TestSortJSGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/sort.json")
	require.NoError(t, err)
	var g struct {
		Cases []struct {
			Kind  string
			Items []sortItem
			Order []int
		}
		Tallies []struct {
			Keys    []string
			Entries [][2]any
			Sorted  [][2]any
		}
	}
	require.NoError(t, json.Unmarshal(raw, &g))
	require.NotEmpty(t, g.Cases)
	chaos := func(a, b sortItem) float64 { return float64((a.ID*7919+b.ID*104729)%5 - 2) }
	desc := func(a, b sortItem) float64 { return jsx.Minus(b.V, a.V) }
	for _, c := range g.Cases {
		items := append([]sortItem(nil), c.Items...)
		if c.Kind == "chaos" {
			jsx.SortJS(items, chaos)
		} else {
			jsx.SortJS(items, desc)
		}
		got := make([]int, len(items))
		for i, it := range items {
			got[i] = it.ID
		}
		if len(c.Order) == 0 {
			c.Order = []int{}
		}
		require.Equal(t, c.Order, got, "%s n=%d", c.Kind, len(c.Items))
	}

	for _, tc := range g.Tallies {
		tally := jsx.NewTally()
		for _, k := range tc.Keys {
			tally.Inc(k)
		}
		entries := tally.Entries()
		require.Equal(t, tc.Entries, pairs(entries), "entries %v", tc.Keys)
		jsx.ByCountDesc(entries)
		require.Equal(t, tc.Sorted, pairs(entries), "sorted %v", tc.Keys)
	}
}

func pairs(es []jsx.Entry) [][2]any {
	out := make([][2]any, len(es))
	for i, e := range es {
		out[i] = [2]any{e.Key, e.Val}
	}
	return out
}
