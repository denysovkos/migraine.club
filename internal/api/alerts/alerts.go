// Package alerts serves /api/user/alerts, /api/user/pressure-alert and
// /api/weather/pressure-outlook.
package alerts

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/pressure"
	"github.com/denysovkos/migraine.club/internal/service/wpi"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var (
	alertsBody    = zod.Object(zod.F("alertsEnabled", zod.Boolean()))
	thresholdBody = zod.Object(zod.F("thresholdHpa", zod.Nullable(zod.Number().Min(pressure.MinThresholdHpa).Max(pressure.MaxThresholdHpa))))
)

type handlers struct {
	d   *app.Deps
	svc *pressure.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	w := &wpi.Service{Q: d.Q, HTTP: d.HTTP, Log: d.Log, APIKey: d.Cfg.OpenWeatherMapAPIKey, TimeoutMs: d.Cfg.OpenWeatherMapTimeoutMs, Now: d.Clock}
	h := handlers{d: d, svc: &pressure.Service{Q: d.Q, WPI: w, Now: d.Clock}}
	r.Get("/api/user/alerts", h.getAlerts)
	r.Put("/api/user/alerts", h.putAlerts)
	r.Get("/api/user/pressure-alert", h.getThreshold)
	r.Put("/api/user/pressure-alert", h.putThreshold)
	r.Get("/api/weather/pressure-outlook", h.outlook)
}

func user(w http.ResponseWriter, r *http.Request) string {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
	}
	return uid
}

func invalid(w http.ResponseWriter, err error) {
	zerr := err.(*zod.Error)
	httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Invalid request", "details", zerr.Flatten().FieldErrors))
}

func (h handlers) getAlerts(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	fail := func(error) { httpx.Error(w, http.StatusInternalServerError, "Failed to fetch alert settings") }
	exists, err := h.d.Q.AlertsColumnExists(r.Context())
	if err != nil {
		exists = false
	}
	st, err := h.svc.Settings(r.Context(), uid)
	if err != nil {
		fail(err)
		return
	}
	if !exists {
		h.d.Log.Warn("alerts_enabled column does not exist - migration pending")
		var tz any
		if st != nil {
			tz = st.Timezone
		}
		httpx.JSON(w, http.StatusOK, httpx.O("alertsEnabled", false, "hasLocation", st != nil, "timezone", tz, "migrationPending", true))
		return
	}
	if st == nil {
		httpx.JSON(w, http.StatusOK, httpx.O("alertsEnabled", false, "hasLocation", false, "timezone", nil))
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("alertsEnabled", st.AlertsEnabled, "hasLocation", true, "timezone", st.Timezone))
}

func (h handlers) putAlerts(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	fail := func() { httpx.Error(w, http.StatusInternalServerError, "Failed to update alert settings") }
	exists, err := h.d.Q.AlertsColumnExists(r.Context())
	if err != nil || !exists {
		h.d.Log.Warn("alerts_enabled column does not exist - migration pending")
		httpx.Error(w, http.StatusServiceUnavailable, "Daily risk alerts feature is not yet available. Database migration pending.")
		return
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail()
		return
	}
	parsed, err := zod.Parse(alertsBody, body)
	if err != nil {
		invalid(w, err)
		return
	}
	enabled := parsed.(map[string]any)["alertsEnabled"].(bool)
	st, err := h.svc.Settings(r.Context(), uid)
	if err != nil {
		fail()
		return
	}
	if st == nil {
		httpx.Error(w, http.StatusBadRequest, "Location not configured. Please set up your location first.")
		return
	}
	if err := h.d.Q.SetAlertsEnabled(r.Context(), enabled, jsontime.New(h.d.Clock()), uid); err != nil {
		fail()
		return
	}
	h.d.Log.Info("Updated user alert settings", "userId", uid, "alertsEnabled", enabled)
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true, "alertsEnabled", enabled))
}

func (h handlers) getThreshold(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	st, err := h.svc.Settings(r.Context(), uid)
	if err != nil {
		httpx.Internal(w)
		return
	}
	var threshold any
	if st != nil && st.PressureDropThresholdHpa != nil {
		threshold = *st.PressureDropThresholdHpa
	}
	httpx.JSON(w, http.StatusOK, httpx.O("hasLocation", st != nil, "thresholdHpa", threshold))
}

func (h handlers) putThreshold(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	// `request.json().catch(() => null)`
	parsed, err := zod.Parse(thresholdBody, httpx.ReadJSONOr(r, nil))
	if err != nil {
		invalid(w, err)
		return
	}
	var threshold *float64
	if v, ok := parsed.(map[string]any)["thresholdHpa"].(float64); ok {
		threshold = &v
	}
	ok, err := h.svc.SetThreshold(r.Context(), uid, threshold)
	if err != nil {
		httpx.Internal(w)
		return
	}
	if !ok {
		httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Location not configured. Please set up your location first.", "code", "SETTINGS_NOT_FOUND"))
		return
	}
	h.d.Log.Info("Updated pressure alert threshold", "userId", uid, "thresholdHpa", threshold)
	var t any
	if threshold != nil {
		t = *threshold
	}
	httpx.JSON(w, http.StatusOK, httpx.O("hasLocation", true, "thresholdHpa", t))
}

func (h handlers) outlook(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	st, err := h.svc.Settings(r.Context(), uid)
	if err != nil {
		httpx.Internal(w)
		return
	}
	if st == nil {
		httpx.JSON(w, http.StatusNotFound, httpx.O("error", "Weather settings not configured", "code", "SETTINGS_NOT_FOUND"))
		return
	}
	res, err := h.svc.Outlook(r.Context(), st)
	if err != nil {
		httpx.Internal(w)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}
