package pressure_test

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/pressure"
	"github.com/denysovkos/migraine.club/internal/service/wpi"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

var berlin, _ = time.LoadLocation("Europe/Berlin")

// series is one point per local day at 12:00 in Berlin, starting at start.
func series(start string, pressures ...float64) []wpi.PressurePoint {
	d, _ := time.ParseInLocation("2006-01-02T15:04", start+"T12:00", berlin)
	out := make([]wpi.PressurePoint, len(pressures))
	for i, p := range pressures {
		out[i] = wpi.PressurePoint{Dt: float64(d.AddDate(0, 0, i).Unix()), PressureHpa: p}
	}
	return out
}

type row struct {
	date   string
	change any
	drop   bool
}

func rows(days []pressure.Day) []row {
	out := make([]row, len(days))
	for i, d := range days {
		var c any
		if d.ChangeHpa != nil {
			c = float64(*d.ChangeHpa)
		}
		out[i] = row{d.Date, c, d.DropAtOrAboveThreshold}
	}
	return out
}

func TestBuildOutlookFlagsFalls(t *testing.T) {
	days := pressure.BuildOutlook(series("2026-11-18", 1020, 1018, 1012, 1013, 1005), "Europe/Berlin", 5, "2026-11-18", 6)
	require.Equal(t, []row{
		{"2026-11-18", nil, false},
		{"2026-11-19", -2.0, false},
		{"2026-11-20", -6.0, true},
		{"2026-11-21", 1.0, false},
		{"2026-11-22", -8.0, true},
	}, rows(days))
}

func TestBuildOutlookEdges(t *testing.T) {
	tz := "Europe/Berlin"
	require.True(t, pressure.BuildOutlook(series("2026-11-18", 1015, 1010), tz, 5, "2026-11-18", 6)[1].DropAtOrAboveThreshold)
	require.False(t, pressure.BuildOutlook(series("2026-11-18", 1000, 1020), tz, 5, "2026-11-18", 6)[1].DropAtOrAboveThreshold)

	past := pressure.BuildOutlook(series("2026-11-17", 1020, 1013, 1012), tz, 5, "2026-11-18", 6)
	require.Len(t, past, 2)
	require.Equal(t, row{"2026-11-18", -7.0, true}, rows(past)[0])

	dt := float64(time.Date(2026, 11, 18, 23, 30, 0, 0, time.UTC).Unix())
	require.Equal(t, "2026-11-19", pressure.BuildOutlook([]wpi.PressurePoint{{Dt: dt, PressureHpa: 1010}}, "Asia/Tokyo", 5, "2026-11-18", 6)[0].Date)

	base := float64(time.Date(2026, 11, 18, 8, 0, 0, 0, berlin).Unix())
	first := pressure.BuildOutlook([]wpi.PressurePoint{{Dt: base + 3600, PressureHpa: 900}, {Dt: base, PressureHpa: 1010}}, tz, 5, "2026-11-18", 6)
	require.Len(t, first, 1)
	require.InDelta(t, 1010, float64(first[0].PressureHpa), 0)

	pts := series("2026-11-18", 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008)
	pts = append(pts, wpi.PressurePoint{Dt: math.NaN(), PressureHpa: 1000})
	capped := pressure.BuildOutlook(pts, tz, 5, "2026-11-18", 3)
	require.Equal(t, []string{"2026-11-18", "2026-11-19", "2026-11-20"}, []string{capped[0].Date, capped[1].Date, capped[2].Date})

	rounded := pressure.BuildOutlook(series("2026-11-18", 1013.27, 1007.04), tz, 5, "2026-11-18", 6)
	b, _ := json.Marshal(rounded[1])
	require.JSONEq(t, `{"date":"2026-11-19","pressureHpa":1007,"changeHpa":-6.2,"dropAtOrAboveThreshold":true}`, string(b))

	require.Equal(t, []pressure.Day{}, pressure.BuildOutlook(nil, tz, 5, "2026-11-18", 6))
}

func newService(t *testing.T, body string, status int) (*pressure.Service, *q.Queries, *int32, *time.Time) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	pool := testdb.New(t)
	qs := q.New(pool)
	now := time.Date(2026, 11, 18, 10, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	w := &wpi.Service{Q: qs, HTTP: http.DefaultClient, APIKey: "key", Now: clock, OneCallURL: srv.URL, BaseURL: srv.URL}
	_, err := pool.Exec(context.Background(), `INSERT INTO "user" (id) VALUES ('u1'), ('u2')`)
	require.NoError(t, err)
	_, err = pool.Exec(context.Background(), `INSERT INTO user_weather_settings (user_id, lat, lon, timezone) VALUES ('u1', 52.5249, 13.4051, 'Europe/Berlin')`)
	require.NoError(t, err)
	return &pressure.Service{Q: qs, WPI: w, Now: func() time.Time { return now }}, qs, &calls, &now
}

func TestForecastPointsCachesByRoundedCoords(t *testing.T) {
	d0 := time.Date(2026, 11, 18, 11, 0, 0, 0, time.UTC).Unix()
	body, _ := json.Marshal(map[string]any{"daily": []map[string]any{{"dt": d0, "pressure": 1012}, {"dt": d0 + 86400, "pressure": 1004}}})
	s, qs, calls, now := newService(t, string(body), 200)
	ctx := context.Background()

	pts, err := s.ForecastPoints(ctx, 52.5249, 13.4051, *now)
	require.NoError(t, err)
	require.Len(t, pts, 2)
	row, err := qs.PressureForecastCache(ctx, 52.52, 13.41)
	require.NoError(t, err)
	require.True(t, row.FetchedAt.Equal(*now))

	// Fresh cache: no provider call.
	_, err = s.ForecastPoints(ctx, 52.5201, 13.4149, now.Add(2*time.Hour))
	require.NoError(t, err)
	require.EqualValues(t, 1, atomic.LoadInt32(calls))

	// Stale cache: refetched.
	_, err = s.ForecastPoints(ctx, 52.52, 13.41, now.Add(3*time.Hour))
	require.NoError(t, err)
	require.EqualValues(t, 2, atomic.LoadInt32(calls))
}

func TestForecastPointsFallsBackToStaleCache(t *testing.T) {
	s, qs, calls, now := newService(t, `{}`, 500)
	ctx := context.Background()
	pts, err := s.ForecastPoints(ctx, 1, 2, *now)
	require.NoError(t, err)
	require.Equal(t, []wpi.PressurePoint{}, pts)

	require.NoError(t, qs.UpsertPressureForecastCache(ctx, 1, 2, []byte(`[{"dt":1,"pressureHpa":1000}]`), jsontime.New(now.Add(-5*time.Hour))))
	pts, err = s.ForecastPoints(ctx, 1, 2, *now)
	require.NoError(t, err)
	require.Equal(t, []wpi.PressurePoint{{Dt: 1, PressureHpa: 1000}}, pts)
	require.EqualValues(t, 2, atomic.LoadInt32(calls))
}

func TestThresholdAndOutlook(t *testing.T) {
	d0 := time.Date(2026, 11, 18, 11, 0, 0, 0, time.UTC).Unix()
	body, _ := json.Marshal(map[string]any{"daily": []map[string]any{
		{"dt": d0 - 86400, "pressure": 1020}, {"dt": d0, "pressure": 1016}, {"dt": d0 + 86400, "pressure": 1009.96},
	}})
	s, _, _, _ := newService(t, string(body), 200)
	ctx := context.Background()

	ok, err := s.SetThreshold(ctx, "u2", ptr(5))
	require.NoError(t, err)
	require.False(t, ok, "no location for u2")

	st, err := s.Settings(ctx, "u1")
	require.NoError(t, err)
	out, err := s.Outlook(ctx, st)
	require.NoError(t, err)
	b, _ := json.Marshal(out)
	require.JSONEq(t, `{"timezone":"Europe/Berlin","alertThresholdHpa":null,"highlightThresholdHpa":5,"days":[
		{"date":"2026-11-18","pressureHpa":1016,"changeHpa":-4,"dropAtOrAboveThreshold":false},
		{"date":"2026-11-19","pressureHpa":1010,"changeHpa":-6,"dropAtOrAboveThreshold":true}]}`, string(b))

	ok, err = s.SetThreshold(ctx, "u1", ptr(3))
	require.NoError(t, err)
	require.True(t, ok)
	st, _ = s.Settings(ctx, "u1")
	out, err = s.Outlook(ctx, st)
	require.NoError(t, err)
	b, _ = json.Marshal(out)
	require.Contains(t, string(b), `"alertThresholdHpa":3,"highlightThresholdHpa":3`)
	require.Contains(t, string(b), `"changeHpa":-4,"dropAtOrAboveThreshold":true`)

	none, err := s.Settings(ctx, "u2")
	require.NoError(t, err)
	require.Nil(t, none)
}

func ptr(v float64) *float64 { return &v }
