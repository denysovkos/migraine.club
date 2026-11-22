package spaceweather

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/zod"
)

func fixture(t *testing.T, name string) any {
	t.Helper()
	raw, err := os.ReadFile("../../../tests/fixtures/kp/" + name)
	require.NoError(t, err)
	v, err := zod.Decode(raw)
	require.NoError(t, err)
	return v
}

func ts(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }

func TestParsers(t *testing.T) {
	now := ts("2025-12-20T10:30:00Z")

	r := ParseNoaa1m(fixture(t, "noaa_1m.json"), now)
	require.NotNil(t, r)
	require.Equal(t, "noaa", r.Provider)
	require.InDelta(t, 2.75, r.Value, 1e-10)
	require.Equal(t, ts("2025-12-20T10:25:00Z"), r.Timestamp)
	require.False(t, r.Stale)
	require.True(t, ParseNoaa1m(fixture(t, "noaa_1m.json"), ts("2025-12-20T10:50:01Z")).Stale)

	f, scale := ParseNoaaForecast(fixture(t, "noaa_forecast.json"), now)
	require.NotNil(t, f)
	require.InDelta(t, 4.33, f.Value, 1e-10)
	require.Equal(t, ts("2025-12-20T09:00:00Z"), f.Timestamp)
	require.False(t, f.Stale)
	require.Equal(t, "G0", *scale)

	require.Nil(t, ParseGfzWebservice(fixture(t, "gfz_webservice_bad.json"), now))
	g := ParseGfzWebservice(fixture(t, "gfz_webservice.json"), now)
	require.NotNil(t, g)
	require.InDelta(t, 4, g.Value, 1e-10)
	require.Equal(t, ts("2025-12-20T06:00:00Z"), g.Timestamp)
	require.False(t, g.Stale)

	n := ParseGfzNowcast(fixture(t, "gfz_nowcast.json"), now)
	require.NotNil(t, n)
	require.InDelta(t, 3.0, n.Value, 1e-10)

	s := ParseGfzLastStorm(fixture(t, "gfz_laststorm.json"))
	require.NotNil(t, s)
	require.Equal(t, 5.0, s.PeakKp)
	require.Equal(t, time.UnixMilli(1734566400000).UTC(), s.StartTime)
	require.Equal(t, time.UnixMilli(1734588000000).UTC(), s.EndTime)

	nasa := ParseNasaDonkiGst(fixture(t, "nasa_donki_gst.json"), now)
	require.NotNil(t, nasa)
	require.Equal(t, 6.0, nasa.Value)
	require.Equal(t, ts("2025-12-20T09:30:00Z"), nasa.Timestamp)
	require.False(t, nasa.Stale)
	require.True(t, ParseNasaDonkiGst(fixture(t, "nasa_donki_gst.json"), ts("2025-12-21T12:00:00Z")).Stale)
}

func TestParsersRejectGarbage(t *testing.T) {
	now := ts("2025-12-20T10:30:00Z")
	for _, v := range []any{nil, "x", []any{}, map[string]any{}} {
		require.Nil(t, ParseNoaa1m(v, now))
		r, _ := ParseNoaaForecast(v, now)
		require.Nil(t, r)
		require.Nil(t, ParseGfzWebservice(v, now))
		require.Nil(t, ParseGfzNowcast(v, now))
		require.Nil(t, ParseGfzLastStorm(v))
		require.Nil(t, ParseNasaDonkiGst(v, now))
	}
}

func TestParseUTCAssumeZ(t *testing.T) {
	for in, want := range map[string]string{
		"2025-12-20T10:25:00":       "2025-12-20T10:25:00Z",
		"2025-12-20 09:00:00":       "2025-12-20T09:00:00Z",
		"2025-12-20T09:00:00Z":      "2025-12-20T09:00:00Z",
		"2025-12-20T11:00:00+02:00": "2025-12-20T09:00:00Z",
		"2025-12-20T11:00:00+0200":  "2025-12-20T09:00:00Z",
	} {
		got, ok := ParseUTCAssumeZ(in)
		require.True(t, ok, in)
		require.Equal(t, ts(want), got, in)
	}
	_, ok := ParseUTCAssumeZ("   ")
	require.False(t, ok)
	_, ok = ParseUTCAssumeZ(12)
	require.False(t, ok)
}

func TestAggregateRules(t *testing.T) {
	now := ts("2025-12-20T10:30:00Z")
	agg := ComputeAggregate(now, []Reading{
		{Provider: "noaa", Value: 4, Timestamp: now},
		{Provider: "gfz", Value: 7, Timestamp: now.Add(-7 * time.Hour), Stale: true},
	}, nil, nil)
	require.Equal(t, 1, agg.SourcesUsed)
	require.Equal(t, 4.0, *agg.AvgKp)
	require.Equal(t, 0.0, *agg.Spread)

	agg = ComputeAggregate(now, []Reading{{Value: 0, Timestamp: now}, {Value: 2, Timestamp: now}}, nil, nil)
	require.Equal(t, 2, agg.SourcesUsed)
	require.Equal(t, 1.0, *agg.AvgKp)

	agg = ComputeAggregate(now, []Reading{{Value: 3, Stale: true}}, nil, nil)
	require.Nil(t, agg.AvgKp)
	require.Equal(t, "Kp not available", *agg.Error)
}
