// Package outcomes serves /api/outcomes, /api/outcomes/monthly and
// /api/outcomes/settings.
package outcomes

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/outcomes"
	"github.com/denysovkos/migraine.club/internal/tz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

const ymd = `^\d{4}-\d{2}-\d{2}$`

var (
	outcomesQuery = zod.Object(
		zod.F("from", zod.Optional(zod.String().Regex(ymd))),
		zod.F("to", zod.Optional(zod.String().Regex(ymd))),
		zod.F("windowDays", zod.Optional(zod.CoerceNumber().Int().Min(1).Max(365))),
	)
	monthlyQuery   = zod.Object(zod.F("months", zod.Default(zod.CoerceNumber().Int().Min(1).Max(36), 12.0)))
	settingsSchema = zod.Object(
		zod.F("baselineFrom", zod.Nullish(zod.String().Regex(ymd))),
		zod.F("baselineTo", zod.Nullish(zod.String().Regex(ymd))),
		zod.F("preferredWindowDays", zod.Optional(zod.Number().Int().Min(1).Max(365))),
	)
)

type handlers struct {
	d   *app.Deps
	svc *outcomes.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &outcomes.Service{Q: d.Q, Now: d.Clock}}
	r.Get("/api/outcomes", h.compute)
	r.Get("/api/outcomes/monthly", h.monthly)
	r.Get("/api/outcomes/settings", h.getSettings)
	r.Put("/api/outcomes/settings", h.putSettings)
}

func user(w http.ResponseWriter, r *http.Request) string {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
	}
	return uid
}

func fail(w http.ResponseWriter, err error) {
	var zerr *zod.Error
	if errors.As(err, &zerr) {
		httpx.ValidationError(w, zerr)
		return
	}
	httpx.Internal(w)
}

func param(r *http.Request, k string) any {
	if v, ok := r.URL.Query()[k]; ok {
		return v[0]
	}
	return zod.Undefined
}

func (h handlers) compute(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	parsed, err := zod.Parse(outcomesQuery, map[string]any{"from": param(r, "from"), "to": param(r, "to"), "windowDays": param(r, "windowDays")})
	if err != nil {
		fail(w, err)
		return
	}
	m := parsed.(map[string]any)
	from, _ := m["from"].(string)
	to, _ := m["to"].(string)
	days, _ := m["windowDays"].(float64)
	res, err := h.svc.Compute(r.Context(), uid, from, to, int(days))
	if err != nil {
		fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) monthly(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	parsed, err := zod.Parse(monthlyQuery, map[string]any{"months": param(r, "months")})
	if err != nil {
		fail(w, err)
		return
	}
	res, err := h.svc.Monthly(r.Context(), uid, int(parsed.(map[string]any)["months"].(float64)))
	if err != nil {
		fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) getSettings(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	s, err := h.svc.GetSettings(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, s.JSON())
}

func (h handlers) putSettings(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(w, err)
		return
	}
	parsed, err := zod.Parse(settingsSchema, body)
	if err != nil {
		fail(w, err)
		return
	}
	m := parsed.(map[string]any)
	current, err := h.svc.GetSettings(r.Context(), uid)
	if err != nil {
		fail(w, err)
		return
	}
	loc, locOK := tz.Load(current.Timezone)
	// A set date is local midnight; an explicit null clears; absent keeps.
	resolve := func(key string, keep *time.Time) (*time.Time, bool) {
		v, present := m[key]
		switch {
		case !present:
			return keep, true
		case v == nil:
			return nil, true
		}
		s := v.(string)
		if s == "" {
			return keep, true
		}
		if !locOK {
			return nil, false
		}
		t, ok := h.svc.LocalStartUTC(s, loc)
		return &t, ok
	}
	start, ok1 := resolve("baselineFrom", current.BaselineStart)
	end, ok2 := resolve("baselineTo", current.BaselineEnd)
	if !ok1 || !ok2 {
		// Luxon's Invalid Date failed to serialize in the write.
		httpx.Internal(w)
		return
	}
	days := current.PreferredWindowDays
	if v, ok := m["preferredWindowDays"].(float64); ok {
		days = int(v)
	}
	if err := h.svc.UpsertSettings(r.Context(), uid, start, end, days); err != nil {
		fail(w, err)
		return
	}
	updated, err := h.svc.GetSettings(r.Context(), uid)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, updated.JSON())
}
