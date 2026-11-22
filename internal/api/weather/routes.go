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
)

type handlers struct {
	d  *app.Deps
	kp *spaceweather.Repo
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, kp: &spaceweather.Repo{Q: d.Q, HTTP: d.HTTP, Log: d.Log}}
	r.Get("/api/space-weather/kp", h.kp_)
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
