// Package wpi is the Weather Pain Index: weather and geomagnetic activity
// condensed into a 0–10 score (WeatherPainIndexService, computeWpi,
// OpenWeatherMapRepository).
package wpi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/spaceweather"
)

// Weather is IOpenWeatherMapData.
type Weather struct {
	DeltaPressure        float64
	TemperatureDeviation float64
	Humidity             float64
	WindSpeed            float64
	UVI                  float64
}

// Components are the normalised factors in their JS key order.
type Components struct {
	PressureFactor float64 `json:"pressureFactor"`
	HumidityFactor float64 `json:"humidityFactor"`
	TempFactor     float64 `json:"tempFactor"`
	WindFactor     float64 `json:"windFactor"`
	UviFactor      float64 `json:"uviFactor"`
	SolarFactor    float64 `json:"solarFactor"`
}

// Result is WpiResult. ComponentsJSON is set when the components came from
// a stored snapshot (jsonb key order) rather than a fresh computation.
type Result struct {
	Score          float64
	Level          string
	Components     Components
	ComponentsJSON json.RawMessage
}

// ComponentsValue is what to marshal for the components.
func (r Result) ComponentsValue() any {
	if len(r.ComponentsJSON) > 0 {
		return r.ComponentsJSON
	}
	return r.Components
}

func clamp(v, lo, hi float64) float64 { return math.Min(hi, math.Max(lo, v)) }

// round is Math.round(x * 10^d) / 10^d with Math.round's tie rule.
func round(x, scale float64) float64 { return math.Floor(x*scale+0.5) / scale }

// Level is toLevel.
func Level(score float64) string {
	switch {
	case score < 2.5:
		return "low"
	case score < 5.0:
		return "moderate"
	case score < 7.5:
		return "high"
	}
	return "very_high"
}

// Compute is computeWpi.
func Compute(w Weather, kp *float64) Result {
	pressure := clamp(w.DeltaPressure/16, 0, 1)
	humidity := clamp((w.Humidity-40)/(80-40), 0, 1)
	temp := clamp(w.TemperatureDeviation/12, 0, 1)
	wind := clamp((w.WindSpeed-2)/(10-2), 0, 1)
	uvi := clamp((w.UVI-1)/(8-1), 0, 1)
	solar := 0.0
	if kp != nil {
		solar = clamp((*kp-2)/(6-2), 0, 1)
	}
	raw := 0.25*pressure + 0.20*humidity + 0.15*temp + 0.15*wind + 0.10*uvi + 0.15*solar
	score := math.Floor(raw*10*10+0.5) / 10
	return Result{
		Score: score,
		Level: Level(score),
		Components: Components{
			PressureFactor: round(pressure, 100), HumidityFactor: round(humidity, 100),
			TempFactor: round(temp, 100), WindFactor: round(wind, 100),
			UviFactor: round(uvi, 100), SolarFactor: round(solar, 100),
		},
	}
}

// ShouldRecomputeForKp is shouldRecomputeWpiForKpChange.
func ShouldRecomputeForKp(recent, current *float64) bool {
	if current == nil {
		return false
	}
	if recent == nil {
		return true
	}
	return math.Abs(*recent-*current) > 1e-6
}

// Solar is SolarActivitySnapshot.
type Solar struct {
	KpIndex      float64
	TimestampUTC time.Time
	Source       string
}

// Computed is ComputeWpiResult.
type Computed struct {
	Result     Result
	SnapshotID string
	Weather    Weather
	KpIndex    *float64
	Solar      *Solar
}

// ErrNoSettings is the "settings not found" error the routes map to 400.
var ErrNoSettings = errors.New("User weather settings not found. Please configure your location first.")

// Service computes and stores WPI.
type Service struct {
	Q      *q.Queries
	HTTP   *http.Client
	Log    *slog.Logger
	APIKey string
	// TimeoutMs is OPENWEATHERMAP_TIMEOUT_MS (default 8000).
	TimeoutMs int
	Now       func() time.Time
	// OneCallURL and BaseURL can be overridden in tests.
	OneCallURL, BaseURL string
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) kpRepo() *spaceweather.Repo {
	return &spaceweather.Repo{Q: s.Q, HTTP: s.HTTP, Log: s.Log}
}

// Settings returns the user's weather settings, or nil.
func (s *Service) Settings(ctx context.Context, userID string) (*q.UserWeatherSetting, error) {
	row, err := s.Q.GetWeatherSettings(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// UpsertSettings is upsertUserSettings.
func (s *Service) UpsertSettings(ctx context.Context, userID string, lat, lon float64, label *string, timezone, units string) (q.UserWeatherSetting, error) {
	return s.Q.UpsertWeatherSettings(ctx, q.UpsertWeatherSettingsParams{
		UserID: userID, Lat: lat, Lon: lon, LocationLabel: label, Timezone: timezone, Units: units,
		Now: jsontime.New(s.now()),
	})
}

// aggregateSolarSnapshot returns the kp_aggregate row for the aggregate at
// ts, writing it if needed. The aggregate's time is that of its newest
// reading, so when a reading goes stale the aggregate changes while its time
// does not: a row of that time with another Kp is then not this aggregate,
// and the new one is recorded at the current time. (Reusing the old row left
// the stored WPI pointing at a Kp the aggregate no longer had, so every
// later read recomputed and stored the WPI again.)
func (s *Service) aggregateSolarSnapshot(ctx context.Context, ts time.Time, kp float64) (*string, error) {
	existing, err := s.Q.SolarReadingBySourceAt(ctx, "kp_aggregate", jsontime.New(ts))
	switch {
	case err == nil && !ShouldRecomputeForKp(&existing.KpIndex, &kp):
		return &existing.ID, nil
	case err == nil:
		ts = s.now().UTC().Truncate(time.Millisecond)
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}
	ids, err := s.Q.InsertSolarSnapshot(ctx, jsontime.New(ts), kp, "kp_aggregate", nil)
	if err != nil {
		return nil, err
	}
	if len(ids) > 0 {
		return &ids[0], nil
	}
	id, err := s.Q.SolarSnapshotBySourceAt(ctx, "kp_aggregate", jsontime.New(ts))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// ComputeAndStore is computeAndStoreForUser.
func (s *Service) ComputeAndStore(ctx context.Context, userID string, at time.Time) (Computed, error) {
	settings, err := s.Settings(ctx, userID)
	if err != nil {
		return Computed{}, err
	}
	if settings == nil {
		return Computed{}, ErrNoSettings
	}
	weather, weatherID, err := s.AggregatedDaily(ctx, settings.Lat, settings.Lon, at)
	if err != nil {
		return Computed{}, err
	}
	agg, err := s.kpRepo().AggregateFromDB(ctx, s.now())
	if err != nil {
		return Computed{}, err
	}
	res := Compute(weather, agg.AvgKp)

	var solarID *string
	var solar *Solar
	if agg.AvgKp != nil {
		if solarID, err = s.aggregateSolarSnapshot(ctx, agg.ComputedAt, *agg.AvgKp); err != nil {
			return Computed{}, err
		}
		solar = &Solar{KpIndex: *agg.AvgKp, TimestampUTC: agg.ComputedAt, Source: "kp_aggregate"}
	}
	components, _ := httpx.Marshal(res.Components)
	id, err := s.Q.InsertWpiSnapshot(ctx, q.InsertWpiSnapshotParams{
		UserID: userID, TimestampLocal: jsontime.New(at), Lat: settings.Lat, Lon: settings.Lon,
		WeatherSnapshotID: weatherID, SolarSnapshotID: solarID,
		WpiScore: res.Score, WpiLevel: res.Level, Components: components,
	})
	if err != nil {
		return Computed{}, err
	}
	if s.Log != nil {
		s.Log.Info("Computed and stored WPI", "userId", userID, "wpiScore", res.Score, "wpiLevel", res.Level)
	}
	return Computed{Result: res, SnapshotID: id, Weather: weather, KpIndex: agg.AvgKp, Solar: solar}, nil
}

// freshness is WPI_FRESHNESS_MS.
const freshness = 3 * time.Hour

// Current is getCurrentWpi.
func (s *Service) Current(ctx context.Context, userID string) (Computed, error) {
	snap, err := s.Q.LatestWpiSnapshot(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && s.now().Sub(snap.CreatedAt.Time) > freshness) {
		return s.ComputeAndStore(ctx, userID, s.now())
	}
	if err != nil {
		return Computed{}, err
	}

	var weather *Weather
	if snap.WeatherSnapshotID != nil {
		ws, err := s.Q.WeatherSnapshotByID(ctx, *snap.WeatherSnapshotID)
		if err == nil {
			weather = &Weather{ws.DeltaPressure, ws.TemperatureDeviation, ws.AvgHumidity, ws.AvgWindSpeed, ws.Uvi}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return Computed{}, err
		}
	}
	var recentSolar *Solar
	if snap.SolarSnapshotID != nil {
		ss, err := s.Q.SolarSnapshotByID(ctx, *snap.SolarSnapshotID)
		if err == nil {
			src := ss.Source
			if src == "" {
				src = "noaa"
			}
			recentSolar = &Solar{KpIndex: ss.KpIndex, TimestampUTC: ss.TimestampUtc.Time, Source: src}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return Computed{}, err
		}
	}

	agg, err := s.kpRepo().AggregateFromDB(ctx, s.now())
	if err != nil {
		return Computed{}, err
	}
	recentKp := agg.AvgKp
	if recentSolar != nil {
		v := recentSolar.KpIndex
		recentKp = &v
	}
	if ShouldRecomputeForKp(recentKp, agg.AvgKp) {
		return s.ComputeAndStore(ctx, userID, s.now())
	}

	solar := recentSolar
	if agg.AvgKp != nil {
		solar = &Solar{KpIndex: *agg.AvgKp, TimestampUTC: agg.ComputedAt, Source: "kp_aggregate"}
	}
	if weather == nil {
		weather = &Weather{Humidity: 50}
	}
	var kp *float64
	if solar != nil {
		v := solar.KpIndex
		kp = &v
	}
	return Computed{
		Result:     Result{Score: snap.WpiScore, Level: snap.WpiLevel, ComponentsJSON: snap.Components},
		SnapshotID: snap.ID, Weather: *weather, KpIndex: kp, Solar: solar,
	}, nil
}

// HistoryPoint is WpiHistoryPoint.
type HistoryPoint struct {
	Timestamp string   `json:"timestamp"`
	Score     float64  `json:"score"`
	Level     string   `json:"level"`
	KpIndex   *float64 `json:"kpIndex"`
}

var closestSources = []string{"noaa", "noaa_now", "noaa_forecast", "gfz", "nasa", "kp_aggregate"}

// History is getHistory: at most one point per UTC day (the latest), newest
// first, at most `days` points.
func (s *Service) History(ctx context.Context, userID string, days int) ([]HistoryPoint, error) {
	start := s.now().AddDate(0, 0, -days)
	rows, err := s.Q.WpiHistory(ctx, userID)
	if err != nil {
		return nil, err
	}
	points := []HistoryPoint{}
	seen := map[string]bool{}
	for _, row := range rows {
		t := row.TimestampLocal.Time
		if t.Before(start) {
			continue
		}
		day := jsontime.Format(t)[:10]
		if seen[day] {
			continue
		}
		seen[day] = true

		var kp *float64
		if row.SolarSnapshotID != nil {
			ss, err := s.Q.SolarSnapshotByID(ctx, *row.SolarSnapshotID)
			if err == nil {
				v := ss.KpIndex
				kp = &v
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return nil, err
			}
		} else {
			near, err := s.Q.SolarSnapshotsBetween(ctx, jsontime.New(t.Add(-6*time.Hour)), jsontime.New(t.Add(6*time.Hour)), closestSources)
			if err != nil {
				return nil, err
			}
			if len(near) > 0 {
				best := near[0]
				bestDiff := absDur(t.Sub(best.TimestampUtc.Time))
				for _, n := range near {
					if d := absDur(t.Sub(n.TimestampUtc.Time)); d < bestDiff {
						best, bestDiff = n, d
					}
				}
				v := best.KpIndex
				kp = &v
			}
		}
		points = append(points, HistoryPoint{Timestamp: jsontime.Format(t), Score: row.WpiScore, Level: row.WpiLevel, KpIndex: kp})
		if len(points) >= days {
			break
		}
	}
	return points, nil
}

func absDur(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// ---------- OpenWeatherMap ----------

func roundCoord(c float64) float64 { return math.Floor(c*100+0.5) / 100 }

func (s *Service) timeout() time.Duration {
	if s.TimeoutMs > 0 {
		return time.Duration(s.TimeoutMs) * time.Millisecond
	}
	return 8 * time.Second
}

func (s *Service) get(ctx context.Context, base string, params url.Values, dst any) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	res, err := s.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return errors.New("Request failed with status code " + strconv.Itoa(res.StatusCode))
	}
	return json.NewDecoder(res.Body).Decode(dst)
}

func (s *Service) oneCall() string {
	if s.OneCallURL != "" {
		return s.OneCallURL
	}
	return "https://api.openweathermap.org/data/3.0/onecall"
}

func (s *Service) base() string {
	if s.BaseURL != "" {
		return s.BaseURL
	}
	return "https://api.openweathermap.org/data/2.5"
}

func coordParams(lat, lon float64) url.Values {
	v := url.Values{}
	v.Set("lat", strconv.FormatFloat(lat, 'f', -1, 64))
	v.Set("lon", strconv.FormatFloat(lon, 'f', -1, 64))
	return v
}

var defaultWeather = Weather{Humidity: 50}

// FetchWeather is getWeather: OneCall, falling back to the basic current
// weather API, falling back to neutral defaults.
func (s *Service) FetchWeather(ctx context.Context, lat, lon float64) Weather {
	if s.APIKey == "" {
		s.warn("OpenWeatherMap API key not configured")
		return defaultWeather
	}
	params := coordParams(lat, lon)
	params.Set("appid", s.APIKey)
	params.Set("units", "metric")
	params.Set("exclude", "minutely,alerts")
	var data struct {
		Hourly []struct {
			Temp      float64 `json:"temp"`
			Humidity  float64 `json:"humidity"`
			Pressure  float64 `json:"pressure"`
			WindSpeed float64 `json:"wind_speed"`
		} `json:"hourly"`
	}
	type cur struct {
		Temp      float64 `json:"temp"`
		Humidity  float64 `json:"humidity"`
		Pressure  float64 `json:"pressure"`
		WindSpeed float64 `json:"wind_speed"`
		UVI       float64 `json:"uvi"`
	}
	var raw struct {
		Current cur `json:"current"`
	}
	var body json.RawMessage
	if err := s.get(ctx, s.oneCall(), params, &body); err != nil {
		s.warn("OneCall API failed, falling back to current weather")
		return s.basicWeather(ctx, lat, lon)
	}
	_ = json.Unmarshal(body, &data)
	_ = json.Unmarshal(body, &raw)
	c := raw.Current
	hourly := data.Hourly
	if len(hourly) > 24 {
		hourly = hourly[:24]
	}
	maxP, minP, maxT, minT := c.Pressure, c.Pressure, c.Temp, c.Temp
	for _, h := range hourly {
		maxP, minP = math.Max(maxP, h.Pressure), math.Min(minP, h.Pressure)
		maxT, minT = math.Max(maxT, h.Temp), math.Min(minT, h.Temp)
	}
	humidity, wind := c.Humidity, c.WindSpeed
	if len(data.Hourly) > 0 {
		var hs, ws float64
		for _, h := range hourly {
			hs += h.Humidity
			ws += h.WindSpeed
		}
		n := float64(len(hourly))
		humidity, wind = hs/n, ws/n
	}
	return Weather{DeltaPressure: maxP - minP, TemperatureDeviation: maxT - minT, Humidity: humidity, WindSpeed: wind, UVI: c.UVI}
}

func (s *Service) basicWeather(ctx context.Context, lat, lon float64) Weather {
	params := coordParams(lat, lon)
	params.Set("appid", s.APIKey)
	params.Set("units", "metric")
	var data struct {
		Main struct {
			Humidity float64 `json:"humidity"`
			TempMin  float64 `json:"temp_min"`
			TempMax  float64 `json:"temp_max"`
		} `json:"main"`
		Wind struct {
			Speed float64 `json:"speed"`
		} `json:"wind"`
		UVI *float64 `json:"uvi"`
	}
	if err := s.get(ctx, s.base()+"/weather", params, &data); err != nil {
		s.errorLog("Failed to fetch basic weather data", err)
		return defaultWeather
	}
	uvi := 0.0
	if data.UVI != nil {
		uvi = *data.UVI
	}
	return Weather{TemperatureDeviation: data.Main.TempMax - data.Main.TempMin, Humidity: data.Main.Humidity, WindSpeed: data.Wind.Speed, UVI: uvi}
}

// PressurePoint is one day of the pressure forecast.
type PressurePoint struct {
	Dt          float64 `json:"dt"`
	PressureHpa float64 `json:"pressureHpa"`
}

// DailyPressureForecast is getDailyPressureForecast.
func (s *Service) DailyPressureForecast(ctx context.Context, lat, lon float64) []PressurePoint {
	if s.APIKey == "" {
		s.warn("OpenWeatherMap API key not configured")
		return []PressurePoint{}
	}
	params := coordParams(lat, lon)
	params.Set("appid", s.APIKey)
	params.Set("units", "metric")
	params.Set("exclude", "current,minutely,hourly,alerts")
	var data struct {
		Daily []struct {
			Dt       *float64 `json:"dt"`
			Pressure *float64 `json:"pressure"`
		} `json:"daily"`
	}
	if err := s.get(ctx, s.oneCall(), params, &data); err != nil {
		s.errorLog("Failed to fetch daily pressure forecast", err)
		return []PressurePoint{}
	}
	out := []PressurePoint{}
	for _, d := range data.Daily {
		if d.Dt != nil && d.Pressure != nil {
			out = append(out, PressurePoint{Dt: *d.Dt, PressureHpa: *d.Pressure})
		}
	}
	return out
}

func (s *Service) warn(msg string) {
	if s.Log != nil {
		s.Log.Warn(msg)
	}
}

func (s *Service) errorLog(msg string, err error) {
	if s.Log != nil {
		s.Log.Error(msg, "error", err)
	}
}

// AggregatedDaily is getAggregatedDaily: the day's weather for rounded
// coordinates, cached in weather_daily_snapshot (today's entry for 3 hours).
func (s *Service) AggregatedDaily(ctx context.Context, lat, lon float64, at time.Time) (Weather, *string, error) {
	rlat, rlon := roundCoord(lat), roundCoord(lon)
	day := jsontime.NewDate(at.UTC())
	cached, err := s.Q.WeatherSnapshotAt(ctx, rlat, rlon, day)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Weather{}, nil, err
	}
	if err == nil && s.freshForToday(cached.Date.Time, cached.CreatedAt.Time) {
		id := cached.ID
		return Weather{cached.DeltaPressure, cached.TemperatureDeviation, cached.AvgHumidity, cached.AvgWindSpeed, cached.Uvi}, &id, nil
	}
	w := s.FetchWeather(ctx, rlat, rlon)
	id, err := s.Q.UpsertWeatherSnapshot(ctx, q.UpsertWeatherSnapshotParams{
		Lat: rlat, Lon: rlon, Date: day, DeltaPressure: w.DeltaPressure, TemperatureDeviation: w.TemperatureDeviation,
		AvgHumidity: w.Humidity, AvgWindSpeed: w.WindSpeed, Uvi: w.UVI, Now: jsontime.New(s.now()),
	})
	if err != nil {
		s.errorLog("Failed to upsert weather snapshot", err)
		return w, nil, nil
	}
	return w, &id, nil
}

func (s *Service) freshForToday(snapshotDate, createdAt time.Time) bool {
	now := s.now().UTC()
	if snapshotDate.Format("2006-01-02") != now.Format("2006-01-02") {
		return true
	}
	return createdAt.After(now.Add(-3 * time.Hour))
}
