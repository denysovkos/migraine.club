// Package preventives serves /api/preventives/*.
package preventives

import (
	"net/http"
	"sort"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/preventives"
	"github.com/denysovkos/migraine.club/internal/zod"
)

// Schemas from src/types/Preventives.ts.
var (
	ymd       = `^\d{4}-\d{2}-\d{2}$`
	kinds     = []string{"oral", "injection", "infusion", "device", "supplement", "other"}
	schedules = []string{"daily", "weekdays", "every_n_days", "every_n_weeks", "custom_weekdays", "on_specific_dates"}
	payload   = zod.Union(zod.Null(), zod.Object(zod.F("n", zod.Number().Int().Positive())),
		zod.Array(zod.Number().Int().Min(1).Max(7)), zod.Array(zod.String().Regex(ymd)))
	reminders = zod.Transform(zod.Array(zod.String().Regex(`^([01]\d|2[0-3]):(00|30)$`)).Max(8), normalizeReminderTimes)

	createSchema = zod.Object(
		zod.F("catalogMedicationId", zod.Nullish(zod.String().GUID())),
		zod.F("name", zod.String().Trim().Min(1).Max(200)),
		zod.F("kind", zod.Enum(kinds...)),
		zod.F("doseText", zod.Nullish(zod.String().Trim().Max(120))),
		zod.F("scheduleType", zod.Enum(schedules...)),
		zod.F("schedulePayload", zod.Nullish(payload)),
		zod.F("startDate", zod.String().Regex(ymd)),
		zod.F("reminderTimes", zod.Optional(reminders)),
		zod.F("remindersEnabled", zod.Optional(zod.Boolean())),
	)
	updateSchema = zod.Object(
		zod.F("name", zod.Optional(zod.String().Trim().Min(1).Max(200))),
		zod.F("kind", zod.Optional(zod.Enum(kinds...))),
		zod.F("doseText", zod.Nullish(zod.String().Trim().Max(120))),
		zod.F("scheduleType", zod.Optional(zod.Enum(schedules...))),
		zod.F("schedulePayload", zod.Nullish(payload)),
		zod.F("startDate", zod.Optional(zod.String().Regex(ymd))),
		zod.F("reminderTimes", zod.Optional(reminders)),
		zod.F("remindersEnabled", zod.Optional(zod.Boolean())),
	)
	intakeSchema = zod.Object(
		zod.F("planId", zod.String().GUID()),
		zod.F("localDate", zod.String().Regex(ymd)),
		zod.F("state", zod.Enum("taken", "missed", "unsure")),
		zod.F("note", zod.Nullish(zod.String().Trim().Max(500))),
	)
	checkInSchema = zod.Object(
		zod.F("planId", zod.String().GUID()),
		zod.F("weekStartLocalDate", zod.String().Regex(ymd)),
		zod.F("sideEffects", zod.Enum("none", "mild", "moderate", "severe")),
		zod.F("stillTaking", zod.Enum("yes", "paused", "stopped")),
		zod.F("note", zod.Nullish(zod.String().Trim().Max(500))),
	)
	stopSchema = zod.Object(
		zod.F("reason", zod.Enum("side_effects", "not_helping", "completed", "cost", "other")),
		zod.F("reasonNote", zod.Nullish(zod.String().Trim().Max(500))),
	)
)

// normalizeReminderTimes: sorted, de-duplicated, capped at 8.
func normalizeReminderTimes(v any) any {
	seen := map[string]bool{}
	out := []string{}
	for _, t := range v.([]any) {
		if s := t.(string); !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	if len(out) > 8 {
		out = out[:8]
	}
	res := make([]any, len(out))
	for i, s := range out {
		res[i] = s
	}
	return res
}

type handlers struct {
	d   *app.Deps
	svc *preventives.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &preventives.Service{Q: d.Q, Now: d.Clock}}
	r.Get("/api/preventives", h.list)
	r.Post("/api/preventives", h.create)
	r.Get("/api/preventives/due", h.due)
	r.Post("/api/preventives/intake", h.intake)
	r.Get("/api/preventives/{id}", h.detail)
	r.Patch("/api/preventives/{id}", h.update)
	r.Delete("/api/preventives/{id}", h.remove)
	r.Post("/api/preventives/{id}/pause", h.status("paused"))
	r.Post("/api/preventives/{id}/resume", h.status("active"))
	r.Post("/api/preventives/{id}/stop", h.stop)
	r.Get("/api/preventives/{id}/summary", h.summary)
	r.Post("/api/preventives/{id}/weekly-checkin", h.checkIn)
}

// gate is the auth + health data consent prologue every route shares.
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

// fail is the routes' `catch (error) { 500 { error: error?.message } }`.
func fail(w http.ResponseWriter, err error) {
	httpx.Error(w, http.StatusInternalServerError, err.Error())
}

func parse(r *http.Request, s zod.Schema) (map[string]any, error) {
	body, err := httpx.ReadJSON(r)
	if err != nil {
		return nil, err
	}
	return parseValue(body, s)
}

func parseValue(body any, s zod.Schema) (map[string]any, error) {
	out, err := zod.Parse(s, body)
	if err != nil {
		return nil, err
	}
	return out.(map[string]any), nil
}

func str(m map[string]any, k string) *string {
	if v, ok := m[k].(string); ok {
		return &v
	}
	return nil
}

func boolp(m map[string]any, k string) *bool {
	if v, ok := m[k].(bool); ok {
		return &v
	}
	return nil
}

func strs(m map[string]any, k string) []string {
	arr, ok := m[k].([]any)
	if !ok {
		return nil
	}
	out := make([]string, len(arr))
	for i, v := range arr {
		out[i] = v.(string)
	}
	return out
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	plans, err := h.svc.List(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("plans", plans))
}

func (h handlers) create(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	m, err := parse(r, createSchema)
	if err != nil {
		fail(w, err)
		return
	}
	id, err := h.svc.Create(r.Context(), uid, preventives.CreateInput{
		CatalogMedicationID: str(m, "catalogMedicationId"), Name: *str(m, "name"), Kind: *str(m, "kind"),
		DoseText: str(m, "doseText"), ScheduleType: *str(m, "scheduleType"), SchedulePayload: m["schedulePayload"],
		StartDate: *str(m, "startDate"), ReminderTimes: strs(m, "reminderTimes"), RemindersEnabled: boolp(m, "remindersEnabled"),
	})
	if err != nil {
		fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, httpx.O("id", id))
}

func (h handlers) due(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	res, err := h.svc.Due(r.Context(), uid, r.URL.Query().Get("localDate"))
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	insight, err := h.svc.RecentInsight(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	var ins any
	if insight != nil {
		ins = insight
	}
	httpx.JSON(w, http.StatusOK, res.Set("insight", ins))
}

func (h handlers) intake(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	m, err := parse(r, intakeSchema)
	if err != nil {
		fail(w, err)
		return
	}
	err = h.svc.UpsertIntake(r.Context(), uid, preventives.IntakeInput{
		PlanID: *str(m, "planId"), LocalDate: *str(m, "localDate"), State: *str(m, "state"), Note: str(m, "note"),
	})
	if err != nil {
		fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}

func (h handlers) detail(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	plan, err := h.svc.Detail(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if plan == nil {
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("plan", plan))
}

func (h handlers) update(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	m, err := parse(r, updateSchema)
	if err != nil {
		fail(w, err)
		return
	}
	_, hasDose := m["doseText"]
	_, hasPayload := m["schedulePayload"]
	err = h.svc.Update(r.Context(), uid, chi.URLParam(r, "id"), preventives.Patch{
		Name: str(m, "name"), Kind: str(m, "kind"), ScheduleType: str(m, "scheduleType"), StartDate: str(m, "startDate"),
		SetDoseText: hasDose, DoseText: str(m, "doseText"),
		SetSchedulePayload: hasPayload, SchedulePayload: m["schedulePayload"],
		ReminderTimes: strs(m, "reminderTimes"), RemindersEnabled: boolp(m, "remindersEnabled"),
	})
	if err != nil {
		fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}

func (h handlers) remove(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), uid, chi.URLParam(r, "id")); err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}

// status serves pause and resume, which had no try/catch.
func (h handlers) status(next string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := h.gate(w, r)
		if !ok {
			return
		}
		if err := h.svc.SetStatus(r.Context(), uid, chi.URLParam(r, "id"), next, nil, nil); err != nil {
			httpx.Unhandled(w)
			return
		}
		httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
	}
}

func (h handlers) stop(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	m, err := parse(r, stopSchema)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if err := h.svc.SetStatus(r.Context(), uid, chi.URLParam(r, "id"), "stopped", str(m, "reason"), str(m, "reasonNote")); err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}

func (h handlers) summary(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	res, err := h.svc.Summary(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) checkIn(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(w, err)
		return
	}
	// `{ ...body, planId: id }`: only an object's own keys survive the
	// schema, whatever else body was.
	spread := map[string]any{}
	if obj, ok := body.(map[string]any); ok {
		for k, v := range obj {
			spread[k] = v
		}
	}
	spread["planId"] = chi.URLParam(r, "id")
	m, err := parseValue(spread, checkInSchema)
	if err != nil {
		fail(w, err)
		return
	}
	err = h.svc.WeeklyCheckIn(r.Context(), uid, preventives.CheckInInput{
		PlanID: *str(m, "planId"), WeekStartLocalDate: *str(m, "weekStartLocalDate"), SideEffects: *str(m, "sideEffects"),
		StillTaking: *str(m, "stillTaking"), Note: str(m, "note"),
	})
	if err != nil {
		fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}
