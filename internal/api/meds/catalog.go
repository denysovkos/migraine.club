package meds

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/meds"
	"github.com/denysovkos/migraine.club/internal/zod"
)

type catalogHandlers struct {
	d   *app.Deps
	cat *meds.Catalog
}

func mountCatalog(r chi.Router, d *app.Deps) {
	h := catalogHandlers{d: d, cat: &meds.Catalog{Pool: d.Pool, Now: d.Clock}}
	r.Get("/api/user-medications", h.list)
	r.Post("/api/user-medications", h.create)
	r.Patch("/api/user-medications/{id}", h.update)
	r.Get("/api/medications/search", h.search)
}

func (h catalogHandlers) gate(w http.ResponseWriter, r *http.Request, message string) (string, bool) {
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
		o := httpx.O("error", "Health data consent required", "code", "CONSENT_REQUIRED")
		if message != "" {
			o.Set("message", message)
		}
		httpx.JSON(w, http.StatusForbidden, o)
		return "", false
	}
	return uid, true
}

func (h catalogHandlers) list(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r, "")
	if !ok {
		return
	}
	res, err := h.cat.List(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h catalogHandlers) create(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r, "")
	if !ok {
		return
	}
	fail := func(err error) {
		h.d.Log.Error("Error creating user medication", "userId", uid, "error", err)
		httpx.Error(w, http.StatusInternalServerError, err.Error())
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(err)
		return
	}
	var in meds.CreateInput
	if err := zod.ParseInto(meds.CreateUserMedSchema, body, &in); err != nil {
		// The Node route had no ZodError branch: the 500 carries the message.
		fail(err)
		return
	}
	id, created, err := h.cat.Create(r.Context(), uid, in)
	if err != nil {
		fail(err)
		return
	}
	if !created {
		httpx.JSON(w, http.StatusOK, httpx.O("userMedicationId", id))
		return
	}
	h.d.Log.Info("User medication created", "userId", uid, "userMedicationId", id)
	httpx.JSON(w, http.StatusCreated, httpx.O("userMedicationId", id))
}

func (h catalogHandlers) update(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r, "")
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	body, err := httpx.ReadJSON(r)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	parsed, err := zod.Parse(meds.UpdateUserMedSchema, body)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	found, err := h.cat.Update(r.Context(), uid, id, parsed.(map[string]any))
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if !found {
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	h.d.Log.Info("User medication updated", "userId", uid, "userMedicationId", id)
	httpx.JSON(w, http.StatusOK, httpx.O("success", true))
}

func (h catalogHandlers) search(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r, "You must provide explicit consent for health data processing before searching meds.")
	if !ok {
		return
	}
	res, err := h.cat.Search(r.Context(), uid, r.URL.Query().Get("q"))
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}
