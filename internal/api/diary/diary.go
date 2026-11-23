// Package diary serves /api/diary/*.
package diary

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/api/idem"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/diary"
	"github.com/denysovkos/migraine.club/internal/zod"
)

const ymdPattern = `^\d{4}-\d{2}-\d{2}$`

var (
	ymd        = zod.String().Regex(ymdPattern)
	rangeQuery = zod.Object(zod.F("from", ymd), zod.F("to", ymd))
	hhmm       = zod.String().Regex(`^([01]\d|2[0-3]):[0-5]\d$`)
	entryBody  = zod.Object(
		zod.F("localDate", ymd),
		zod.F("patch", zod.Object(
			zod.F("dayType", zod.Optional(zod.Enum("headache_free", "headache_day", "migraine_day"))),
			zod.F("impact", zod.Optional(zod.Nullable(zod.Number().Int().Min(0).Max(4)))),
			zod.F("notes", zod.Optional(zod.Nullable(zod.String().Max(2000)))),
			zod.F("bedTimeLocal", zod.Optional(zod.Nullable(hhmm))),
			zod.F("wakeTimeLocal", zod.Optional(zod.Nullable(hhmm))),
		)),
	)
)

type handlers struct {
	d   *app.Deps
	svc *diary.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &diary.Service{Q: d.Q, Now: d.Clock}}
	r.Get("/api/diary/range", h.rangeRoute)
	r.Get("/api/diary/today", h.today)
	r.Get("/api/diary/overlap", h.overlap)
	r.Get("/api/diary/day", h.day)
	r.Put("/api/diary/entry", h.entry)
}

// queryValue is searchParams.get(k): null when absent.
func queryValue(r *http.Request, k string) any {
	v, ok := r.URL.Query()[k]
	if !ok || len(v) == 0 {
		return nil
	}
	return v[0]
}

func (h handlers) fail(w http.ResponseWriter, err error) {
	var zerr *zod.Error
	var derr *diary.Error
	switch {
	case errors.As(err, &zerr):
		httpx.ValidationError(w, zerr)
	case errors.As(err, &derr):
		status := http.StatusBadRequest
		if derr.Code == "NOT_EDITABLE" {
			status = http.StatusForbidden
		}
		o := httpx.O("error", derr.Message, "code", derr.Code)
		if derr.Details != nil {
			o.Set("details", derr.Details)
		}
		httpx.JSON(w, status, o)
	default:
		h.d.Log.Error("diary request failed", "error", err)
		httpx.Internal(w)
	}
}

func (h handlers) user(w http.ResponseWriter, r *http.Request) string {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
	}
	return uid
}

func (h handlers) rangeRoute(w http.ResponseWriter, r *http.Request) {
	uid := h.user(w, r)
	if uid == "" {
		return
	}
	var in struct{ From, To string }
	if err := zod.ParseInto(rangeQuery, map[string]any{"from": queryValue(r, "from"), "to": queryValue(r, "to")}, &in); err != nil {
		h.fail(w, err)
		return
	}
	res, err := h.svc.Range(r.Context(), uid, in.From, in.To)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) today(w http.ResponseWriter, r *http.Request) {
	uid := h.user(w, r)
	if uid == "" {
		return
	}
	res, err := h.svc.Today(r.Context(), uid)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) overlap(w http.ResponseWriter, r *http.Request) {
	uid := h.user(w, r)
	if uid == "" {
		return
	}
	var in struct{ From, To string }
	if err := zod.ParseInto(rangeQuery, map[string]any{"from": queryValue(r, "from"), "to": queryValue(r, "to")}, &in); err != nil {
		h.fail(w, err)
		return
	}
	days, err := h.svc.Overlap(r.Context(), uid, in.From, in.To)
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("overlapDays", days))
}

func (h handlers) day(w http.ResponseWriter, r *http.Request) {
	uid := h.user(w, r)
	if uid == "" {
		return
	}
	v, err := zod.Parse(ymd, queryValue(r, "date"))
	if err != nil {
		h.fail(w, err)
		return
	}
	res, err := h.svc.Day(r.Context(), uid, v.(string))
	if err != nil {
		h.fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) entry(w http.ResponseWriter, r *http.Request) {
	uid := h.user(w, r)
	if uid == "" {
		return
	}
	idem.Wrap(h.d.Q, h.d.Log, h.d.Clock, w, r, uid, "diary/entry", func(w http.ResponseWriter, r *http.Request) {
		body, err := httpx.ReadJSON(r)
		if err != nil {
			h.fail(w, err)
			return
		}
		parsed, err := zod.Parse(entryBody, body)
		if err != nil {
			h.fail(w, err)
			return
		}
		m := parsed.(map[string]any)
		res, err := h.svc.Upsert(r.Context(), uid, m["localDate"].(string), diary.PatchFrom(m["patch"].(map[string]any)))
		if err != nil {
			h.fail(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, res)
	})
}
