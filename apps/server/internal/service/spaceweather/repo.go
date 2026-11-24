package spaceweather

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
)

// Repo reads and syncs Kp snapshots.
type Repo struct {
	Q    *q.Queries
	HTTP *http.Client
	Log  *slog.Logger
	// Endpoints can be overridden in tests.
	Endpoints Endpoints
}

// Endpoints are the upstream URLs.
type Endpoints struct {
	Noaa1m, NoaaForecast, Gfz, GfzNowcast, GfzLastStorm, Nasa string
}

// DefaultEndpoints are the production providers.
var DefaultEndpoints = Endpoints{
	Noaa1m:       "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json",
	NoaaForecast: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
	Gfz:          "https://kp.gfz.de/app/json/",
	GfzNowcast:   "https://kp.gfz.de/app/json/kpnowcast.json",
	GfzLastStorm: "https://kp.gfz.de/app/json/laststorm.json",
	Nasa:         "https://api.nasa.gov/DONKI/GST",
}

func (r *Repo) endpoints() Endpoints {
	if r.Endpoints.Noaa1m == "" {
		return DefaultEndpoints
	}
	return r.Endpoints
}

// rawObject splits a jsonb object into its members, keeping each one as raw
// JSON so that echoing it back preserves the key order Postgres returned.
func rawObject(raw json.RawMessage) map[string]json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}

func present(v json.RawMessage) bool { return len(v) > 0 && string(v) != "null" }

func rowToReading(row q.SolarActivitySnapshot, now time.Time) Reading {
	raw := rawObject(row.Raw)
	provider := "noaa"
	switch row.Source {
	case "gfz":
		provider = "gfz"
	case "nasa":
		provider = "nasa"
	}
	stale := false
	switch row.Source {
	case "noaa_now":
		stale = OlderThanMinutes(now, row.TimestampUtc.Time, 20)
	case "noaa_forecast", "gfz":
		stale = OlderThanMinutes(now, row.TimestampUtc.Time, 6*60)
	case "nasa":
		stale = OlderThanMinutes(now, row.TimestampUtc.Time, 24*60)
	}
	out := Reading{Provider: provider, Value: row.KpIndex, Timestamp: row.TimestampUtc.Time, Stale: stale}
	// raw: rawPayload ?? raw; meta: rawMeta ?? { sourceId }
	switch {
	case present(raw["raw"]):
		out.Raw = raw["raw"]
	case raw != nil:
		out.Raw = row.Raw
	}
	if present(raw["meta"]) {
		out.Meta = raw["meta"]
	} else {
		out.Meta = httpx.O("sourceId", row.Source)
	}
	return out
}

func rowToLastStorm(row q.SolarActivitySnapshot) *Storm {
	raw := rawObject(row.Raw)
	if !present(raw["lastStorm"]) {
		return nil
	}
	var ls struct {
		StartTime, EndTime, PeakTime string
		PeakKp                       *float64
	}
	if json.Unmarshal(raw["lastStorm"], &ls) != nil || ls.PeakKp == nil {
		return nil
	}
	start, err1 := jsontime.Parse(ls.StartTime)
	end, err2 := jsontime.Parse(ls.EndTime)
	peakT, err3 := jsontime.Parse(ls.PeakTime)
	peakKp := *ls.PeakKp
	if err1 != nil || err2 != nil || err3 != nil {
		return nil
	}
	return &Storm{StartTime: start, EndTime: end, PeakKp: peakKp, PeakTime: peakT}
}

// AggregateFromDB is getAggregateFromDb.
func (r *Repo) AggregateFromDB(ctx context.Context, now time.Time) (Aggregate, error) {
	sources := []string{"noaa_now", "noaa_forecast", "gfz", "nasa", "gfz_laststorm"}
	latest, err := r.Q.LatestSolarBySources(ctx, sources)
	if err != nil {
		return Aggregate{}, err
	}
	rows := make([]*q.SolarActivitySnapshot, len(sources))
	for i, s := range sources {
		for j := range latest {
			if latest[j].Source == s {
				rows[i] = &latest[j]
			}
		}
	}
	noaaNow, noaaForecast, gfz, nasa, lastStorm := rows[0], rows[1], rows[2], rows[3], rows[4]

	var nowR, fcR *Reading
	if noaaNow != nil {
		v := rowToReading(*noaaNow, now)
		nowR = &v
	}
	if noaaForecast != nil {
		v := rowToReading(*noaaForecast, now)
		fcR = &v
	}
	var chosen *Reading
	switch {
	case nowR != nil && !nowR.Stale:
		chosen = nowR
	case fcR != nil && !fcR.Stale:
		chosen = fcR
	case nowR != nil:
		chosen = nowR
	default:
		chosen = fcR
	}
	var readings []Reading
	if chosen != nil {
		readings = append(readings, *chosen)
	}
	if gfz != nil {
		readings = append(readings, rowToReading(*gfz, now))
	}
	if nasa != nil {
		readings = append(readings, rowToReading(*nasa, now))
	}

	var scale *string
	if noaaForecast != nil {
		var meta struct {
			NoaaScale *string `json:"noaaScale"`
		}
		if m := rawObject(noaaForecast.Raw)["meta"]; present(m) && json.Unmarshal(m, &meta) == nil {
			scale = meta.NoaaScale
		}
	}

	computedAt := now
	var best *time.Time
	for _, row := range rows {
		if row != nil && (best == nil || row.CreatedAt.After(*best)) {
			t := row.CreatedAt.Time
			best = &t
		}
	}
	if best != nil {
		computedAt = *best
	}
	var storm *Storm
	if lastStorm != nil {
		storm = rowToLastStorm(*lastStorm)
	}
	return ComputeAggregate(computedAt, readings, scale, storm), nil
}

// fetchJSON GETs a JSON document with a timeout.
func (r *Repo) fetchJSON(ctx context.Context, rawURL string, timeout time.Duration) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := r.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("Fetch failed: %d %s", res.StatusCode, http.StatusText(res.StatusCode))
	}
	var v any
	if err := json.NewDecoder(res.Body).Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}

func isoSeconds(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05Z") }

// SyncResult is the outcome of SyncFromSources.
type SyncResult struct {
	Inserted         int
	InsertedBySource *httpx.Object
}

// SyncFromSources is syncFromSources: fetch every provider and store new
// readings.
func (r *Repo) SyncFromSources(ctx context.Context, now time.Time) (SyncResult, error) {
	ep := r.endpoints()
	type noaaOut struct {
		reading *Reading
		source  string
		scale   *string
	}
	var (
		wg        sync.WaitGroup
		noaa      noaaOut
		gfz, nasa *Reading
		storm     *Storm
	)
	wg.Add(4)
	go func() {
		defer wg.Done()
		if data, err := r.fetchJSON(ctx, ep.Noaa1m, 4*time.Second); err == nil {
			if rd := ParseNoaa1m(data, now); rd != nil && !rd.Stale {
				noaa = noaaOut{reading: rd, source: "noaa_now"}
				return
			}
		}
		if data, err := r.fetchJSON(ctx, ep.NoaaForecast, 5*time.Second); err == nil {
			if rd, scale := ParseNoaaForecast(data, now); rd != nil && !rd.Stale {
				noaa = noaaOut{reading: rd, source: "noaa_forecast", scale: scale}
				if scale == nil {
					noaa.scale = nil
				}
				return
			}
		}
	}()
	go func() {
		defer wg.Done()
		u := fmt.Sprintf("%s?start=%s&end=%s&index=Kp", ep.Gfz,
			url.QueryEscape(isoSeconds(now.Add(-48*time.Hour))), url.QueryEscape(isoSeconds(now.Add(48*time.Hour))))
		if data, err := r.fetchJSON(ctx, u, 5*time.Second); err == nil {
			if rd := ParseGfzWebservice(data, now); rd != nil && !rd.Stale {
				gfz = rd
				return
			}
		}
		if data, err := r.fetchJSON(ctx, ep.GfzNowcast, 4*time.Second); err == nil {
			if rd := ParseGfzNowcast(data, now); rd != nil && !rd.Stale {
				gfz = rd
			}
		}
	}()
	go func() {
		defer wg.Done()
		key := os.Getenv("NASA_API_KEY")
		if key == "" {
			return
		}
		u := fmt.Sprintf("%s?startDate=%s&endDate=%s&api_key=%s", ep.Nasa,
			url.QueryEscape(now.Add(-30*24*time.Hour).UTC().Format("2006-01-02")),
			url.QueryEscape(now.UTC().Format("2006-01-02")), url.QueryEscape(key))
		if data, err := r.fetchJSON(ctx, u, 5*time.Second); err == nil {
			nasa = ParseNasaDonkiGst(data, now)
		}
	}()
	go func() {
		defer wg.Done()
		if data, err := r.fetchJSON(ctx, ep.GfzLastStorm, 5*time.Second); err == nil {
			storm = ParseGfzLastStorm(data)
		}
	}()
	wg.Wait()

	bySource := httpx.NewObject()
	inserted := 0
	insert := func(source string, ts time.Time, kp float64, raw any) error {
		b, err := httpx.Marshal(raw)
		if err != nil {
			return err
		}
		ids, err := r.Q.InsertSolarSnapshot(ctx, jsontime.New(ts), kp, source, b)
		if err != nil {
			return err
		}
		if len(ids) > 0 {
			inserted++
			n, _ := bySource.Get(source)
			c, _ := n.(int)
			bySource.Set(source, c+1)
		}
		return nil
	}
	fetchedAt := jsontime.Format(now)
	withSourceID := func(meta any, fallback string) *httpx.Object {
		out := httpx.NewObject()
		var sourceID any = fallback
		if m, ok := meta.(*httpx.Object); ok {
			for _, k := range m.Keys() {
				v, _ := m.Get(k)
				out.Set(k, v)
			}
			if v, ok := m.Get("sourceId"); ok && v != nil {
				sourceID = v
			}
		}
		out.Set("sourceId", sourceID)
		return out
	}
	rawOrNull := func(v any) any { return v }

	if noaa.reading != nil {
		meta := withSourceID(noaa.reading.Meta, noaa.source)
		meta.Set("noaaScale", noaa.scale)
		if err := insert(noaa.source, noaa.reading.Timestamp, noaa.reading.Value,
			httpx.O("fetchedAt", fetchedAt, "meta", meta, "raw", rawOrNull(noaa.reading.Raw))); err != nil {
			return SyncResult{}, err
		}
	}
	if gfz != nil {
		if err := insert("gfz", gfz.Timestamp, gfz.Value,
			httpx.O("fetchedAt", fetchedAt, "meta", withSourceID(gfz.Meta, "gfz"), "raw", rawOrNull(gfz.Raw))); err != nil {
			return SyncResult{}, err
		}
	}
	if nasa != nil {
		if err := insert("nasa", nasa.Timestamp, nasa.Value,
			httpx.O("fetchedAt", fetchedAt, "meta", withSourceID(nasa.Meta, "nasa_donki_gst"), "raw", rawOrNull(nasa.Raw))); err != nil {
			return SyncResult{}, err
		}
	}
	if storm != nil {
		if err := insert("gfz_laststorm", storm.PeakTime, storm.PeakKp, httpx.O(
			"fetchedAt", fetchedAt,
			"lastStorm", httpx.O(
				"startTime", jsontime.Format(storm.StartTime), "endTime", jsontime.Format(storm.EndTime),
				"peakKp", storm.PeakKp, "peakTime", jsontime.Format(storm.PeakTime)),
		)); err != nil {
			return SyncResult{}, err
		}
	}
	if r.Log != nil {
		r.Log.Info("SpaceWeather Kp sync completed", "inserted", inserted)
	}
	return SyncResult{Inserted: inserted, InsertedBySource: bySource}, nil
}

// AggregateJSON is the /api/space-weather/kp response body.
func AggregateJSON(agg Aggregate) *httpx.Object {
	var storm any
	if agg.LastStorm != nil {
		storm = httpx.O(
			"startTime", jsontime.Format(agg.LastStorm.StartTime),
			"endTime", jsontime.Format(agg.LastStorm.EndTime),
			"peakKp", agg.LastStorm.PeakKp,
			"peakTime", jsontime.Format(agg.LastStorm.PeakTime))
	}
	readings := make([]any, len(agg.Readings))
	for i, r := range agg.Readings {
		readings[i] = httpx.O(
			"provider", r.Provider, "value", r.Value, "timestamp", jsontime.Format(r.Timestamp),
			"stale", r.Stale, "raw", r.Raw, "meta", r.Meta)
	}
	return httpx.O(
		"avgKp", agg.AvgKp,
		"sourcesUsed", agg.SourcesUsed,
		"computedAt", jsontime.Format(agg.ComputedAt),
		"minKp", agg.MinKp,
		"maxKp", agg.MaxKp,
		"spread", agg.Spread,
		"noaaScale", agg.NoaaScale,
		"lastStorm", storm,
		"error", agg.Error,
		"readings", readings,
	)
}
