package spaceweather_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/spaceweather"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

func ts(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }

func upstream(t *testing.T) *httptest.Server {
	files := map[string]string{
		"/noaa1m": "noaa_1m.json", "/noaafc": "noaa_forecast.json", "/gfz": "gfz_webservice.json",
		"/gfznow": "gfz_nowcast.json", "/storm": "gfz_laststorm.json", "/nasa": "nasa_donki_gst.json",
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name, ok := files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		b, err := os.ReadFile("../../../tests/fixtures/kp/" + name)
		require.NoError(t, err)
		_, _ = w.Write(b)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestSyncThenAggregate(t *testing.T) {
	pool := testdb.New(t)
	srv := upstream(t)
	t.Setenv("NASA_API_KEY", "k")
	repo := &spaceweather.Repo{Q: q.New(pool), HTTP: srv.Client(), Endpoints: spaceweather.Endpoints{
		Noaa1m: srv.URL + "/noaa1m", NoaaForecast: srv.URL + "/noaafc", Gfz: srv.URL + "/gfz",
		GfzNowcast: srv.URL + "/gfznow", GfzLastStorm: srv.URL + "/storm", Nasa: srv.URL + "/nasa",
	}}
	ctx := context.Background()
	now := ts("2025-12-20T10:30:00Z")

	res, err := repo.SyncFromSources(ctx, now)
	require.NoError(t, err)
	require.Equal(t, 4, res.Inserted)
	b, _ := httpx.Marshal(res.InsertedBySource)
	require.JSONEq(t, `{"noaa_now":1,"gfz":1,"nasa":1,"gfz_laststorm":1}`, string(b))

	// A second sync finds nothing new.
	res, err = repo.SyncFromSources(ctx, now)
	require.NoError(t, err)
	require.Zero(t, res.Inserted)

	agg, err := repo.AggregateFromDB(ctx, now)
	require.NoError(t, err)
	require.Equal(t, 3, agg.SourcesUsed)
	require.InDelta(t, (2.75+4+6)/3, *agg.AvgKp, 1e-9)
	require.Equal(t, 5.0, agg.LastStorm.PeakKp)

	out, _ := httpx.Marshal(spaceweather.AggregateJSON(agg))
	var body map[string]any
	require.NoError(t, json.Unmarshal(out, &body))
	readings := body["readings"].([]any)
	require.Len(t, readings, 3)
	first := readings[0].(map[string]any)
	require.Equal(t, "noaa", first["provider"])
	require.Equal(t, "noaa_1m", first["meta"].(map[string]any)["sourceId"])
	require.True(t, strings.HasPrefix(string(out), `{"avgKp":`))

	// Hours later every reading is stale: no average, an explicit error.
	agg, err = repo.AggregateFromDB(ctx, now.Add(48*time.Hour))
	require.NoError(t, err)
	require.Nil(t, agg.AvgKp)
	require.Equal(t, "Kp not available", *agg.Error)
}

func TestAggregateWithEmptyDatabase(t *testing.T) {
	pool := testdb.New(t)
	repo := &spaceweather.Repo{Q: q.New(pool)}
	now := ts("2025-12-20T10:30:00Z")
	agg, err := repo.AggregateFromDB(context.Background(), now)
	require.NoError(t, err)
	out, _ := httpx.Marshal(spaceweather.AggregateJSON(agg))
	require.Equal(t, `{"avgKp":null,"sourcesUsed":0,"computedAt":"2025-12-20T10:30:00.000Z","minKp":null,"maxKp":null,"spread":null,"noaaScale":null,"lastStorm":null,"error":"Kp not available","readings":[]}`, string(out))
}
