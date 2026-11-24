package wpi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/wpi"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

const oneCall = `{"current":{"temp":10,"humidity":70,"pressure":1010,"wind_speed":4,"uvi":3},
 "hourly":[{"temp":8,"humidity":60,"pressure":1002,"wind_speed":2},{"temp":14,"humidity":80,"pressure":1012,"wind_speed":6}],
 "daily":[{"dt":100,"pressure":1012},{"dt":200,"pressure":1004},{"dt":300}]}`

func owm(t *testing.T, body string, status int) (*httptest.Server, *int32) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		require.Equal(t, "key", r.URL.Query().Get("appid"))
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func newService(t *testing.T, url string) (*wpi.Service, *q.Queries) {
	s, qs, _ := newServiceWithPool(t, url)
	return s, qs
}

func newServiceWithPool(t *testing.T, url string) (*wpi.Service, *q.Queries, *pgxpool.Pool) {
	pool := testdb.New(t)
	qs := q.New(pool)
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	return &wpi.Service{Q: qs, HTTP: http.DefaultClient, APIKey: "key", Now: func() time.Time { return now },
		OneCallURL: url, BaseURL: url}, qs, pool
}

func TestFetchWeatherAggregatesHourly(t *testing.T) {
	srv, _ := owm(t, oneCall, 200)
	s, _ := newService(t, srv.URL)
	w := s.FetchWeather(context.Background(), 52.52, 13.4)
	require.Equal(t, wpi.Weather{DeltaPressure: 10, TemperatureDeviation: 6, Humidity: 70, WindSpeed: 4, UVI: 3}, w)

	require.Equal(t, []wpi.PressurePoint{{Dt: 100, PressureHpa: 1012}, {Dt: 200, PressureHpa: 1004}},
		s.DailyPressureForecast(context.Background(), 52.52, 13.4))
}

func TestFetchWeatherFallsBack(t *testing.T) {
	srv, _ := owm(t, `{}`, 500)
	s, _ := newService(t, srv.URL)
	require.Equal(t, wpi.Weather{Humidity: 50}, s.FetchWeather(context.Background(), 1, 2))
	require.Empty(t, s.DailyPressureForecast(context.Background(), 1, 2))

	s.APIKey = ""
	require.Equal(t, wpi.Weather{Humidity: 50}, s.FetchWeather(context.Background(), 1, 2))
}

func TestComputeStoreAndCache(t *testing.T) {
	srv, calls := owm(t, oneCall, 200)
	s, qs := newService(t, srv.URL)
	ctx := context.Background()

	_, err := s.ComputeAndStore(ctx, "u", s.Now())
	require.ErrorIs(t, err, wpi.ErrNoSettings)

	_, err = s.UpsertSettings(ctx, "u", 52.5163, 13.3777, nil, "Europe/Berlin", "metric")
	require.NoError(t, err)

	got, err := s.ComputeAndStore(ctx, "u", s.Now())
	require.NoError(t, err)
	require.Equal(t, wpi.Compute(wpi.Weather{10, 6, 70, 4, 3}, nil), got.Result)
	require.Nil(t, got.KpIndex)
	require.EqualValues(t, 1, *calls)

	// Today's snapshot for the rounded coordinates is reused within 3 hours.
	_, err = s.ComputeAndStore(ctx, "u", s.Now())
	require.NoError(t, err)
	require.EqualValues(t, 1, *calls)
	snap, err := qs.WeatherSnapshotAt(ctx, 52.52, 13.38, wpiDate(s.Now()))
	require.NoError(t, err)
	require.Equal(t, 10.0, snap.DeltaPressure)

	// The current WPI is the stored snapshot while it is fresh.
	cur, err := s.Current(ctx, "u")
	require.NoError(t, err)
	require.Equal(t, got.Result.Score, cur.Result.Score)
	require.JSONEq(t, `{"pressureFactor":0.63,"humidityFactor":0.75,"tempFactor":0.5,"windFactor":0.25,"uviFactor":0.29,"solarFactor":0}`, string(cur.Result.ComponentsJSON))

	hist, err := s.History(ctx, "u", 14)
	require.NoError(t, err)
	require.Len(t, hist, 1, "one point per day")
	require.Equal(t, "2026-03-10T12:00:00.000Z", hist[0].Timestamp)
}

func wpiDate(t time.Time) jsontime.Date { return jsontime.NewDate(t) }

// When a Kp reading goes stale the aggregate changes without any new row,
// so its time (the newest source row) stays the same. The recomputed WPI
// must point at a solar row with the Kp it was computed from: before, it
// reused the earlier aggregate row of that time, so every later read saw a
// Kp mismatch and recomputed (and stored) the WPI again.
func TestCurrentRecomputesOnceWhenTheKpAggregateChanges(t *testing.T) {
	srv, _ := owm(t, oneCall, 200)
	s, _, pool := newServiceWithPool(t, srv.URL)
	ctx := context.Background()
	start := s.Now()
	now := start
	s.Now = func() time.Time { return now }
	_, err := s.UpsertSettings(ctx, "u", 52.5163, 13.3777, nil, "Europe/Berlin", "metric")
	require.NoError(t, err)

	solar := func(source string, at time.Time, kp float64) {
		_, err := pool.Exec(ctx, `INSERT INTO solar_activity_snapshot (timestamp_utc, kp_index, source, raw, created_at) VALUES ($1, $2, $3, '{}', $4)`, at, kp, source, at.UTC())
		require.NoError(t, err)
	}
	solar("gfz", start.Add(-time.Hour), 5)
	solar("noaa_now", start.Add(-5*time.Minute), 3)

	first, err := s.ComputeAndStore(ctx, "u", now)
	require.NoError(t, err)
	require.InDelta(t, 4.0, *first.KpIndex, 1e-9, "both readings are fresh")

	// Half an hour later the 1-minute NOAA reading is stale: only GFZ counts.
	now = start.Add(30 * time.Minute)
	cur, err := s.Current(ctx, "u")
	require.NoError(t, err)
	require.InDelta(t, 5.0, *cur.KpIndex, 1e-9)

	snapshots := func() int {
		var n int
		require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM weather_pain_index_snapshot WHERE user_id = 'u'`).Scan(&n))
		return n
	}
	require.Equal(t, 2, snapshots(), "the changed aggregate is computed once")

	for range 3 {
		now = now.Add(time.Minute)
		again, err := s.Current(ctx, "u")
		require.NoError(t, err)
		require.Equal(t, cur.Result.Score, again.Result.Score)
	}
	require.Equal(t, 2, snapshots(), "and then served from the stored snapshot")
}
