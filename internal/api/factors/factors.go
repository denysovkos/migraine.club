// Package factors serves /api/factors/*.
package factors

import (
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/denysovkos/migraine.club/internal/api/idem"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/factors"
	"github.com/denysovkos/migraine.club/internal/zod"
)

type handlers struct {
	d   *app.Deps
	svc *factors.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &factors.Service{Pool: d.Pool, Q: d.Q, Now: d.Clock}}
	r.Post("/api/factors/log", h.log)
	r.Get("/api/factors/options", h.options)
}

func (h handlers) log(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	idem.Wrap(h.d.Q, h.d.Log, h.d.Clock, w, r, uid, "factors/log", func(w http.ResponseWriter, r *http.Request) {
		body, err := httpx.ReadJSON(r)
		if err != nil {
			httpx.Unhandled(w)
			return
		}
		var in factors.LogInput
		if err := zod.ParseInto(factors.LogSchema, body, &in); err != nil {
			httpx.Unhandled(w)
			return
		}
		factorID, eventID, at, err := h.svc.Log(r.Context(), uid, in)
		if err != nil {
			if errors.Is(err, factors.ErrConsent) {
				httpx.JSON(w, http.StatusForbidden, httpx.O("error", "Health data consent required", "code", "CONSENT_REQUIRED"))
				return
			}
			h.d.Log.Error("Failed to log factor event", "userId", uid, "error", err)
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg.Code == "42703" {
				httpx.Error(w, http.StatusInternalServerError, "Database schema is out of date. Please run migrations (npm run db:migrate).")
				return
			}
			httpx.Internal(w)
			return
		}
		httpx.JSON(w, http.StatusOK, httpx.O("ok", true, "factorId", factorID, "eventId", eventID, "occurredAt", jsontime.Format(at)))
	})
}

var ymdRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func (h handlers) options(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	ok, err := consent.HasHealthDataConsent(r.Context(), h.d.Q, uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if !ok {
		httpx.JSON(w, http.StatusForbidden, httpx.O("error", "Health data consent required", "code", "CONSENT_REQUIRED"))
		return
	}
	ymd := r.URL.Query().Get("localDate")
	if ymd != "" {
		if _, perr := time.Parse("2006-01-02", ymd); !ymdRe.MatchString(ymd) || perr != nil {
			httpx.Error(w, http.StatusBadRequest, "Invalid localDate")
			return
		}
	}
	res, err := h.svc.Options(r.Context(), uid, ymd)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}
