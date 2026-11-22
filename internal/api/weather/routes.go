// Package weather serves the weather, Weather Pain Index and space weather
// routes.
package weather

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/spaceweather"
	"github.com/denysovkos/migraine.club/internal/service/wpi"
)

type handlers struct {
	d   *app.Deps
	kp  *spaceweather.Repo
	wpi *wpi.Service
}

// NewWPI builds the WPI service from deps.
func NewWPI(d *app.Deps) *wpi.Service {
	return &wpi.Service{Q: d.Q, HTTP: d.HTTP, Log: d.Log, APIKey: d.Cfg.OpenWeatherMapAPIKey, TimeoutMs: d.Cfg.OpenWeatherMapTimeoutMs, Now: d.Clock}
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, kp: &spaceweather.Repo{Q: d.Q, HTTP: d.HTTP, Log: d.Log}, wpi: NewWPI(d)}
	r.Get("/api/space-weather/kp", h.kp_)
	r.Get("/api/weather-pain-index/current", h.current)
	r.Get("/api/weather-pain-index/forecast", h.forecast)
	r.Get("/api/weather-pain-index/history", h.history)
	r.Get("/api/user/weather-settings", h.getSettings)
	r.Put("/api/user/weather-settings", h.putSettings)
}

// GET /api/space-weather/kp
func (h handlers) kp_(w http.ResponseWriter, r *http.Request) {
	if auth.UserID(r.Context()) == "" {
		httpx.Unauthorized(w)
		return
	}
	agg, err := h.kp.AggregateFromDB(r.Context(), h.d.Clock())
	if err != nil {
		// The Node route had no try/catch: Next answered 500 with an empty body.
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	httpx.JSON(w, http.StatusOK, spaceweather.AggregateJSON(agg))
}
