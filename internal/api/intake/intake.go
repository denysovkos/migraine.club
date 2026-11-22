// Package intake serves /api/intake/*.
package intake

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/intake"
	"github.com/denysovkos/migraine.club/internal/zod"
)

type handlers struct {
	d   *app.Deps
	svc *intake.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &intake.Service{Pool: d.Pool, Q: d.Q, Now: d.Clock}}
	r.Get("/api/intake", h.get)
	r.Patch("/api/intake", h.patch)
	r.Post("/api/intake/complete", h.complete)
	r.Post("/api/intake/skip", h.skip)
}

func (h handlers) gate(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return "", false
	}
	ok, err := consent.HasHealthDataConsent(r.Context(), h.d.Q, uid)
	if err != nil {
		httpx.Unhandled(w)
		return "", false
	}
	if !ok {
		httpx.JSON(w, http.StatusForbidden, httpx.O("error", "Health data consent required", "code", "CONSENT_REQUIRED"))
		return "", false
	}
	return uid, true
}

func (h handlers) get(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	dto, err := h.svc.Get(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, dto.JSON())
}

func (h handlers) patch(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	fail := func(err error) {
		var zerr *zod.Error
		if errors.As(err, &zerr) {
			httpx.ValidationError(w, zerr)
			return
		}
		httpx.Internal(w)
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(err)
		return
	}
	patch, err := zod.Parse(intake.PatchSchema, body)
	if err != nil {
		fail(err)
		return
	}
	dto, err := h.svc.PatchBlock(r.Context(), uid, patch.(map[string]any))
	if err != nil {
		fail(err)
		return
	}
	httpx.JSON(w, http.StatusOK, dto.JSON())
}

func (h handlers) complete(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	dto, err := h.svc.Complete(r.Context(), uid)
	if err != nil {
		h.d.Log.Error("intake complete failed", "userId", uid, "error", err)
		httpx.Internal(w)
		return
	}
	httpx.JSON(w, http.StatusOK, dto.JSON())
}

func (h handlers) skip(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	dto, err := h.svc.Skip(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, dto.JSON())
}
