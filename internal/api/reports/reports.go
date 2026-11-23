// Package reports serves the clinician report preview, MOH status, the acute
// medication report and appointment-prep drafts.
package reports

import (
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/acutemeds"
	"github.com/denysovkos/migraine.club/internal/service/appointmentprep"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/reports"
	"github.com/denysovkos/migraine.club/internal/zod"
)

const ymd = `^\d{4}-\d{2}-\d{2}$`

var (
	mohQuery    = zod.Object(zod.F("windowDays", zod.Optional(zod.CoerceNumber().Int().Min(1).Max(60))))
	reportQuery = zod.Object(zod.F("mode", zod.Optional(zod.Enum("rolling30", "calendarMonth"))))
	text        = func(max int) zod.Schema { return zod.Nullish(zod.String().Trim().Max(max)) }
	draftBody   = zod.Object(
		zod.F("appointmentDate", zod.String().Regex(ymd)),
		zod.F("visitLabel", text(200)),
		zod.F("clinicianName", text(200)),
		zod.F("visitReason", text(500)),
		zod.F("topConcerns", zod.Default(zod.Array(zod.String().Trim().Max(200)), []any{})),
		zod.F("doctorQuestions", zod.Default(zod.Array(zod.String().Trim().Max(200)), []any{})),
		zod.F("personalNotes", text(4000)),
		zod.F("compareWindowDays", zod.Optional(zod.CoerceNumber().Int().Min(1).Max(365))),
	)
	draftPatch = zod.Object(
		zod.F("appointmentDate", zod.Optional(zod.String().Regex(ymd))),
		zod.F("visitLabel", text(200)),
		zod.F("clinicianName", text(200)),
		zod.F("visitReason", text(500)),
		zod.F("topConcerns", zod.Optional(zod.Array(zod.String().Trim().Max(200)))),
		zod.F("doctorQuestions", zod.Optional(zod.Array(zod.String().Trim().Max(200)))),
		zod.F("personalNotes", text(4000)),
	)
	notFound = regexp.MustCompile(`(?i)not found`)
)

type handlers struct {
	d     *app.Deps
	rep   *reports.Service
	preps *appointmentprep.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, rep: &reports.Service{Q: d.Q, Now: d.Clock}, preps: &appointmentprep.Service{Q: d.Q, Now: d.Clock}}
	r.Get("/api/reports/clinician/preview", h.preview)
	r.Post("/api/reports/clinician/model", h.model)
	r.Get("/api/moh-status", h.moh)
	r.Get("/api/acute-meds-report", h.acuteReport)
	r.Get("/api/appointment-preps", h.listDrafts)
	r.Post("/api/appointment-preps", h.createDraft)
	r.Get("/api/appointment-preps/{id}", h.getDraft)
	r.Patch("/api/appointment-preps/{id}", h.patchDraft)
	r.Delete("/api/appointment-preps/{id}", h.deleteDraft)
}

func jsonError(w http.ResponseWriter, status int, body *httpx.Object) { httpx.JSON(w, status, body) }

func (h handlers) preview(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	var parsed any = map[string]any{}
	if raw := r.URL.Query().Get("config"); raw != "" {
		// JSON.parse(rawConfig): no BOM stripping, unlike request.json().
		if httpx.JSONSyntaxMessage(raw) != "" {
			jsonError(w, http.StatusBadRequest, httpx.O("error", "Invalid config JSON"))
			return
		}
		v, err := zod.Decode([]byte(raw))
		if err != nil {
			jsonError(w, http.StatusBadRequest, httpx.O("error", "Invalid config JSON"))
			return
		}
		parsed = v
	}
	cfg, err := reports.ParseConfig(parsed)
	var zerr *zod.Error
	if errors.As(err, &zerr) {
		jsonError(w, http.StatusBadRequest, httpx.O("error", "Invalid config", "details", zerr.Issues))
		return
	}
	var model *reports.Model
	if err == nil {
		model, err = h.rep.Build(r.Context(), uid, cfg)
	}
	if err != nil {
		h.d.Log.Error("clinician preview failed", "error", err)
		jsonError(w, http.StatusInternalServerError, httpx.O("error", "Failed to generate preview"))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(reports.RenderHTML(model)))
}

// model is POST /api/reports/clinician/model: the report model the browser
// renders the PDF from, with the old PDF route's errors.
func (h handlers) model(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		jsonError(w, http.StatusUnauthorized, httpx.O("error", "Unauthorized"))
		return
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		jsonError(w, http.StatusBadRequest, httpx.O("error", "Invalid JSON body"))
		return
	}
	if body == nil {
		body = map[string]any{}
	}
	cfg, err := reports.ParseConfig(body)
	var zerr *zod.Error
	if errors.As(err, &zerr) {
		jsonError(w, http.StatusBadRequest, httpx.O("error", "Invalid config", "details", zerr.Issues))
		return
	}
	var model *reports.Model
	if err == nil {
		model, err = h.rep.Build(r.Context(), uid, cfg)
	}
	if err != nil {
		h.d.Log.Error("clinician report model failed", "error", err)
		jsonError(w, http.StatusInternalServerError, httpx.O("error", "PDF_GENERATION_FAILED"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, model)
}

// gate is auth plus health-data consent.
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

func param(r *http.Request, k string) any {
	if v, ok := r.URL.Query()[k]; ok {
		return v[0]
	}
	return zod.Undefined
}

func validationOrInternal(w http.ResponseWriter, err error) {
	var zerr *zod.Error
	if errors.As(err, &zerr) {
		httpx.ValidationError(w, zerr)
		return
	}
	httpx.Internal(w)
}

func (h handlers) moh(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	parsed, err := zod.Parse(mohQuery, map[string]any{"windowDays": param(r, "windowDays")})
	if err != nil {
		validationOrInternal(w, err)
		return
	}
	days := 30
	if v, ok := parsed.(map[string]any)["windowDays"].(float64); ok {
		days = int(v)
	}
	res, err := acutemeds.MohStatus(r.Context(), h.d.Q, uid, h.d.Clock(), days)
	if err != nil {
		validationOrInternal(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) acuteReport(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	parsed, err := zod.Parse(reportQuery, map[string]any{"mode": param(r, "mode")})
	if err != nil {
		validationOrInternal(w, err)
		return
	}
	mode, _ := parsed.(map[string]any)["mode"].(string)
	if mode == "" {
		mode = "rolling30"
	}
	res, err := acutemeds.Report(r.Context(), h.d.Q, uid, mode, h.d.Clock())
	if err != nil {
		validationOrInternal(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) listDrafts(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	drafts, err := h.preps.List(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("drafts", drafts))
}

// draftFail is the drafts routes' catch: flatten() for ZodError, 404 for a
// "not found" message, otherwise the message as a 500.
func draftFail(w http.ResponseWriter, err error, notFoundOK bool) {
	var zerr *zod.Error
	switch {
	case errors.As(err, &zerr):
		httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Validation error", "details", zerr.Flatten()))
	case notFoundOK && notFound.MatchString(err.Error()):
		httpx.Error(w, http.StatusNotFound, "Not found")
	default:
		httpx.Error(w, http.StatusInternalServerError, err.Error())
	}
}

func strp(m map[string]any, k string) *string {
	if v, ok := m[k].(string); ok {
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

func (h handlers) createDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	body, err := httpx.ReadJSON(r)
	var parsed any
	if err == nil {
		parsed, err = zod.Parse(draftBody, body)
	}
	var id string
	if err == nil {
		m := parsed.(map[string]any)
		in := appointmentprep.Input{AppointmentDate: m["appointmentDate"].(string), VisitLabel: strp(m, "visitLabel"),
			ClinicianName: strp(m, "clinicianName"), VisitReason: strp(m, "visitReason"), PersonalNotes: strp(m, "personalNotes"),
			TopConcerns: strs(m, "topConcerns"), DoctorQuestions: strs(m, "doctorQuestions")}
		if v, ok := m["compareWindowDays"].(float64); ok {
			in.CompareWindowDays = int(v)
		}
		id, err = h.preps.Create(r.Context(), uid, in)
	}
	if err != nil {
		draftFail(w, err, false)
		return
	}
	httpx.JSON(w, http.StatusCreated, httpx.O("id", id))
}

func (h handlers) getDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	d, err := h.preps.Get(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if d == nil {
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("draft", appointmentprep.Draft(*d, true)))
}

func (h handlers) patchDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	body, err := httpx.ReadJSON(r)
	var parsed any
	if err == nil {
		parsed, err = zod.Parse(draftPatch, body)
	}
	if err != nil {
		draftFail(w, err, true)
		return
	}
	m := parsed.(map[string]any)
	has := func(k string) bool { _, ok := m[k]; return ok }
	p := appointmentprep.Patch{AppointmentDate: strp(m, "appointmentDate"),
		VisitLabel: strp(m, "visitLabel"), SetVisitLabel: has("visitLabel"),
		ClinicianName: strp(m, "clinicianName"), SetClinicianName: has("clinicianName"),
		VisitReason: strp(m, "visitReason"), SetVisitReason: has("visitReason"),
		PersonalNotes: strp(m, "personalNotes"), SetPersonalNotes: has("personalNotes"),
		TopConcerns: strs(m, "topConcerns"), SetTopConcerns: has("topConcerns"),
		DoctorQuestions: strs(m, "doctorQuestions"), SetDoctorQuestions: has("doctorQuestions")}
	d, err := h.preps.Update(r.Context(), uid, chi.URLParam(r, "id"), p)
	if err != nil {
		draftFail(w, err, true)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("draft", appointmentprep.Draft(*d, true)))
}

func (h handlers) deleteDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	if err := h.preps.Delete(r.Context(), uid, chi.URLParam(r, "id")); err != nil {
		draftFail(w, err, true)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}
