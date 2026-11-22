package weather

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/zod"
)

func settingsNotFound(message string) *httpx.Object {
	return httpx.O("error", "Weather settings not configured", "code", "SETTINGS_NOT_FOUND", "message", message)
}

// GET /api/weather-pain-index/current
func (h handlers) current(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	fail := func(err error) {
		h.d.Log.Error("Error fetching current WPI", "error", err)
		if strings.Contains(err.Error(), "settings not found") {
			httpx.JSON(w, http.StatusBadRequest, settingsNotFound(err.Error()))
			return
		}
		httpx.Internal(w)
	}
	settings, err := h.wpi.Settings(r.Context(), userID)
	if err != nil {
		fail(err)
		return
	}
	if settings == nil {
		httpx.JSON(w, http.StatusBadRequest, settingsNotFound("Please configure your location to get weather pain index data."))
		return
	}
	data, err := h.wpi.Current(r.Context(), userID)
	if err != nil {
		fail(err)
		return
	}
	var solarTs, solarSource any
	if data.Solar != nil {
		solarTs, solarSource = jsontime.Format(data.Solar.TimestampUTC), data.Solar.Source
	}
	httpx.JSON(w, http.StatusOK, httpx.O(
		"timestamp", jsontime.Format(h.d.Clock()),
		"score", data.Result.Score,
		"level", data.Result.Level,
		"components", data.Result.ComponentsValue(),
		"weather", httpx.O(
			"deltaPressure", data.Weather.DeltaPressure,
			"temperatureDeviation", data.Weather.TemperatureDeviation,
			"humidity", data.Weather.Humidity,
			"windSpeed", data.Weather.WindSpeed,
			"uvi", data.Weather.UVI),
		"solar", httpx.O("kpIndex", data.KpIndex, "timestampUtc", solarTs, "source", solarSource),
	))
}

// GET /api/weather-pain-index/forecast
func (h handlers) forecast(w http.ResponseWriter, r *http.Request) {
	if auth.UserID(r.Context()) == "" {
		httpx.Unauthorized(w)
		return
	}
	latest, err := h.d.Q.LatestNoaaKp(r.Context())
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.JSON(w, http.StatusOK, httpx.O("hasAlert", false, "level", nil, "kpIndex", nil, "timestampUtc", nil, "message", nil))
		return
	}
	if err != nil {
		h.d.Log.Error("Error fetching solar forecast", "error", err)
		httpx.Internal(w)
		return
	}
	if h.d.Clock().Sub(latest.TimestampUtc.Time).Hours() >= 7 {
		h.d.Log.Warn("Using stale Kp index data (cron job may need attention)")
	}
	hasAlert, level, message := false, any(nil), any(nil)
	switch {
	case latest.KpIndex >= 5:
		hasAlert, level, message = true, "danger", "solar_storm_warning"
	case latest.KpIndex >= 4:
		hasAlert, level, message = true, "warning", "high_activity_warning"
	}
	httpx.JSON(w, http.StatusOK, httpx.O(
		"hasAlert", hasAlert, "level", level, "kpIndex", latest.KpIndex,
		"timestampUtc", jsontime.Format(latest.TimestampUtc.Time), "message", message))
}

// GET /api/weather-pain-index/history
func (h handlers) history(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	days := 14
	if v := r.URL.Query().Get("days"); v != "" {
		n, ok := jsx.ParseInt(v)
		if !ok || n < 1 || n > 90 {
			httpx.Error(w, http.StatusBadRequest, "Invalid days parameter. Must be between 1 and 90.")
			return
		}
		days = n
	}
	points, err := h.wpi.History(r.Context(), userID, days)
	if err != nil {
		h.d.Log.Error("Error fetching WPI history", "error", err)
		httpx.Internal(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("points", points))
}

var weatherSettingsSchema = zod.Object(
	zod.F("lat", zod.Number().Min(-90).Max(90)),
	zod.F("lon", zod.Number().Min(-180).Max(180)),
	zod.F("locationLabel", zod.Optional(zod.String().Max(200))),
	zod.F("timezone", zod.Default(zod.String().Min(1).Max(100), "UTC")),
	zod.F("units", zod.Default(zod.Enum("metric", "imperial"), "metric")),
)

func settingsJSON(lat, lon float64, label *string, tz, units string) *httpx.Object {
	return httpx.O("lat", lat, "lon", lon, "locationLabel", label, "timezone", tz, "units", units)
}

// GET /api/user/weather-settings
func (h handlers) getSettings(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	s, err := h.wpi.Settings(r.Context(), userID)
	if err != nil {
		h.d.Log.Error("Error fetching weather settings", "error", err)
		httpx.Internal(w)
		return
	}
	if s == nil {
		httpx.JSON(w, http.StatusNotFound, httpx.O("error", "Weather settings not configured", "code", "SETTINGS_NOT_FOUND"))
		return
	}
	httpx.JSON(w, http.StatusOK, settingsJSON(s.Lat, s.Lon, s.LocationLabel, s.Timezone, s.Units))
}

// PUT /api/user/weather-settings
func (h handlers) putSettings(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	fail := func(err error) {
		h.d.Log.Error("Error updating weather settings", "error", err)
		httpx.Internal(w)
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(err)
		return
	}
	var in struct {
		Lat           float64 `json:"lat"`
		Lon           float64 `json:"lon"`
		LocationLabel *string `json:"locationLabel"`
		Timezone      string  `json:"timezone"`
		Units         string  `json:"units"`
	}
	if err := zod.ParseInto(weatherSettingsSchema, body, &in); err != nil {
		var zerr *zod.Error
		if errors.As(err, &zerr) {
			h.d.Log.Warn("Validation error updating weather settings")
			httpx.ValidationError(w, zerr)
			return
		}
		fail(err)
		return
	}
	s, err := h.wpi.UpsertSettings(r.Context(), userID, in.Lat, in.Lon, in.LocationLabel, in.Timezone, in.Units)
	if err != nil {
		fail(err)
		return
	}
	h.d.Log.Info("Weather settings updated", "userId", userID)
	httpx.JSON(w, http.StatusOK, settingsJSON(s.Lat, s.Lon, s.LocationLabel, s.Timezone, s.Units))
}

