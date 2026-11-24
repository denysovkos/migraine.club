// Package insights serves /api/insights, /api/insights/recompute and
// /api/insights/test-plans.
package insights

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/insights"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var (
	windowDays = zod.Refine(zod.CoerceNumber().Int(), func(v any) bool {
		switch v.(float64) {
		case 30, 60, 90, 180:
			return true
		}
		return false
	}, "windowDays must be one of 30, 60, 90, 180")
	createPlan = zod.Object(
		zod.F("factorId", zod.String().GUID()),
		zod.F("direction", zod.Enum("reduce", "increase")),
		zod.F("startDate", zod.String().Regex(`^\d{4}-\d{2}-\d{2}$`)),
		zod.F("durationDays", zod.Optional(zod.Number().Int().Min(7).Max(60))),
		zod.F("notes", zod.Optional(zod.String().Max(1000))),
		zod.F("reminderEnabled", zod.Optional(zod.Boolean())),
	)
	listPlans = zod.Object(zod.F("status", zod.Optional(zod.Enum("active", "completed", "cancelled"))))
	patchPlan = zod.Object(
		zod.F("status", zod.Optional(zod.Enum("completed", "cancelled"))),
		zod.F("notes", zod.Optional(zod.String().Max(1000))),
		zod.F("reminderEnabled", zod.Optional(zod.Boolean())),
	)
)

type handlers struct {
	d   *app.Deps
	svc *insights.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &insights.Service{Q: d.Q, Log: d.Log, Now: d.Clock}}
	r.Get("/api/insights", h.get)
	r.Post("/api/insights/recompute", h.recompute)
	r.Get("/api/insights/test-plans", h.listPlans)
	r.Post("/api/insights/test-plans", h.createPlan)
	r.Patch("/api/insights/test-plans/{id}", h.patchPlan)
}

func (h handlers) consent(w http.ResponseWriter, r *http.Request, uid string) (bool, bool) {
	ok, err := consent.HasHealthDataConsent(r.Context(), h.d.Q, uid)
	if err != nil {
		httpx.Unhandled(w)
		return false, false
	}
	return ok, true
}

func ready(windowDays int, payload any, computedAt, status string) *httpx.Object {
	return httpx.O("state", "ready", "windowDays", windowDays, "methodVersion", insights.MethodVersion,
		"payload", payload, "computedAt", computedAt, "status", status)
}

func (h handlers) get(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	if !h.d.Cfg.EnableInsights {
		httpx.JSON(w, http.StatusOK, httpx.O("state", "disabled", "message", "Insights are not enabled."))
		return
	}
	ok, fine := h.consent(w, r, uid)
	if !fine {
		return
	}
	if !ok {
		httpx.JSON(w, http.StatusForbidden, httpx.O("state", "consent_required", "message", "Health data consent required."))
		return
	}
	raw := "90"
	if v, ok := r.URL.Query()["windowDays"]; ok {
		raw = v[0]
	} else if v, ok := r.URL.Query()["window"]; ok {
		raw = v[0]
	}
	parsed, err := zod.Parse(windowDays, raw)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	days := int(parsed.(float64))
	cached, err := h.svc.Latest(r.Context(), uid, days)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	now := h.d.Clock()
	if cached == nil || cached.Stale || now.Sub(cached.ComputedAt.Time) > 24*time.Hour {
		res, err := h.svc.ComputeAndStore(r.Context(), uid, days, now)
		if err == nil {
			httpx.JSON(w, http.StatusOK, ready(days, res.Payload, res.Payload.ComputedAt, res.Status))
			return
		}
		h.d.Log.Error("Insights recompute failed", "error", err, "userId", uid, "windowDays", days)
		if cached != nil {
			httpx.JSON(w, http.StatusOK, ready(days, cached.PayloadJson, jsontime.Format(cached.ComputedAt.Time), "stale"))
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "Failed to compute insights")
		return
	}
	httpx.JSON(w, http.StatusOK, ready(days, cached.PayloadJson, jsontime.Format(cached.ComputedAt.Time), "ready"))
}

func (h handlers) recompute(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	if !h.d.Cfg.EnableInsights {
		httpx.Error(w, http.StatusForbidden, "Insights are not enabled.")
		return
	}
	ok, fine := h.consent(w, r, uid)
	if !fine {
		return
	}
	if !ok {
		httpx.Error(w, http.StatusForbidden, "Health data consent required.")
		return
	}
	// `body?.windowDays ?? '90'` on `request.json().catch(() => ({}))`.
	var raw any = "90"
	if m, isObj := httpx.ReadJSONOr(r, map[string]any{}).(map[string]any); isObj {
		if v, has := m["windowDays"]; has && v != nil {
			raw = v
		}
	}
	parsed, err := zod.Parse(windowDays, raw)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	days := int(parsed.(float64))
	cached, err := h.svc.Latest(r.Context(), uid, days)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if cached != nil && h.d.Clock().Sub(cached.ComputedAt.Time) < 5*time.Minute {
		httpx.Error(w, http.StatusTooManyRequests, "Insights were recently refreshed.")
		return
	}
	res, err := h.svc.ComputeAndStore(r.Context(), uid, days, h.d.Clock())
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, ready(days, res.Payload, res.Payload.ComputedAt, res.Status))
}

// gate is the test-plan routes' prologue.
func (h handlers) gate(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return "", false
	}
	ok, fine := h.consent(w, r, uid)
	if !fine {
		return "", false
	}
	if !ok {
		httpx.Error(w, http.StatusForbidden, "Health data consent required.")
		return "", false
	}
	return uid, true
}

func (h handlers) listPlans(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	var status any = zod.Undefined
	if v, has := r.URL.Query()["status"]; has {
		status = v[0]
	}
	parsed, err := zod.Parse(listPlans, map[string]any{"status": status})
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	var st *string
	if s, has := parsed.(map[string]any)["status"].(string); has {
		st = &s
	}
	plans, err := h.svc.TestPlans(r.Context(), uid, st)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("plans", plans))
}

func strp(m map[string]any, k string) *string {
	if v, ok := m[k].(string); ok {
		return &v
	}
	return nil
}

func (h handlers) createPlan(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	body, err := httpx.ReadJSON(r)
	var parsed any
	if err == nil {
		parsed, err = zod.Parse(createPlan, body)
	}
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	m := parsed.(map[string]any)
	start, err := localdate.JSDateFromYMD(m["startDate"].(string))
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	days := int32(14)
	if v, has := m["durationDays"].(float64); has {
		days = int32(v)
	}
	reminder := true
	if v, has := m["reminderEnabled"].(bool); has {
		reminder = v
	}
	id, err := h.d.Q.InsertInsightTestPlan(r.Context(), insightsInsert(uid, m, start, days, reminder, h.d.Clock()))
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	h.d.Log.Info("Test mode started", "metric", "test_mode_started", "userId", uid, "factorId", m["factorId"])
	httpx.JSON(w, http.StatusOK, httpx.O("id", id))
}

func (h handlers) patchPlan(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	body, err := httpx.ReadJSON(r)
	var parsed any
	if err == nil {
		parsed, err = zod.Parse(patchPlan, body)
	}
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	m := parsed.(map[string]any)
	id := chi.URLParam(r, "id")
	status := strp(m, "status")
	_, hasNotes := m["notes"]
	params := planPatch(uid, id, status, hasNotes, strp(m, "notes"), m, h.d.Clock())
	if err := h.d.Q.UpdateInsightTestPlan(r.Context(), params); err != nil {
		httpx.Unhandled(w)
		return
	}
	if status != nil && *status == "completed" {
		h.d.Log.Info("Test mode completed", "metric", "test_mode_completed", "userId", uid, "planId", id)
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}
