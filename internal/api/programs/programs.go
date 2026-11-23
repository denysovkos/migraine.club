// Package programs serves /api/programs/*.
package programs

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/service/programs"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

const hhmm = `^([01]\d|2[0-3]):[0-5]\d$`

var (
	settingsPatch = zod.Object(
		zod.F("enabled", zod.Optional(zod.Boolean())),
		zod.F("notificationsConfig", zod.Optional(zod.Object(
			zod.F("windDown", zod.Optional(zod.Boolean())),
			zod.F("morningCheckIn", zod.Optional(zod.Boolean())),
			zod.F("onsetNudge", zod.Optional(zod.Boolean())),
			zod.F("weeklyDigest", zod.Optional(zod.Boolean())),
		))),
	)
	enrollBody = zod.Object(zod.F("targetPayload", zod.Union(
		zod.Object(zod.F("bedTime", zod.String().Regex(hhmm)), zod.F("wakeTime", zod.String().Regex(hhmm)),
			zod.F("toleranceMinutes", zod.Number().Int().Min(0).Max(180))),
		zod.Object(zod.F("acuteWindowMinutes", zod.Number().Int().Min(1).Max(360))),
	)))
	enrollmentBody = zod.Object(zod.F("enrollmentId", zod.Number().Int()))
	sleepLogBody   = zod.Object(
		zod.F("localDate", zod.String().Regex(`^\d{4}-\d{2}-\d{2}$`)),
		zod.F("bedTimeLocal", zod.Nullable(zod.String().Regex(hhmm))),
		zod.F("wakeTimeLocal", zod.Nullable(zod.String().Regex(hhmm))),
	)
)

type handlers struct {
	d   *app.Deps
	svc *programs.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &programs.Service{Q: d.Q, Now: d.Clock}}
	r.Get("/api/programs", h.list)
	r.Get("/api/programs/settings", h.getSettings)
	r.Patch("/api/programs/settings", h.patchSettings)
	r.Get("/api/programs/enrollments", h.enrollments)
	r.Get("/api/programs/recommendations", h.recommendations)
	r.Post("/api/programs/recommendations/{programId}/dismiss", h.dismiss)
	r.Post("/api/programs/sleep-regularity/log", h.sleepLog)
	r.Get("/api/programs/sleep-regularity/today-status", h.todayStatus)
	r.Get("/api/programs/acute-med-timing/attack/{id}", h.attack)
	r.Get("/api/programs/{programId}", h.detail)
	r.Post("/api/programs/{programId}/enroll", h.enroll)
	r.Post("/api/programs/{programId}/pause", h.status("paused"))
	r.Post("/api/programs/{programId}/resume", h.status("active"))
	r.Post("/api/programs/{programId}/end", h.status("ended"))
	r.Get("/api/programs/{programId}/progress", h.progress)
}

func user(w http.ResponseWriter, r *http.Request) string {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
	}
	return uid
}

// gate is auth plus the "Module disabled" 404.
func (h handlers) gate(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid := user(w, r)
	if uid == "" {
		return "", false
	}
	s, err := h.svc.GetSettings(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return "", false
	}
	if !s.Enabled {
		httpx.Error(w, http.StatusNotFound, "Module disabled")
		return "", false
	}
	return uid, true
}

func (h handlers) today(r *http.Request, uid string) (string, string, error) {
	zone, err := usertz.Get(r.Context(), h.d.Q, uid)
	if err != nil {
		return "", "", err
	}
	return zone, luxon.ISODate(h.d.Clock().In(tz.LoadOrUTC(zone))), nil
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.gate(w, r); !ok {
		return
	}
	out := []any{}
	for _, d := range programs.Definitions() {
		out = append(out, httpx.O("id", d.ID, "title", d.Title, "shape", d.Shape, "durationWeeks", d.DurationWeeks,
			"citationCount", len(d.Citations)))
	}
	httpx.JSON(w, http.StatusOK, httpx.O("programs", out))
}

func (h handlers) detail(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "programId")
	def := programs.Lookup(id)
	if def == nil {
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	// ?locale wins, then the first Accept-Language tag's primary subtag.
	locale := "en"
	if v, has := r.URL.Query()["locale"]; has {
		locale = v[0]
	} else if al, has := r.Header["Accept-Language"]; has {
		locale = strings.SplitN(strings.SplitN(strings.Join(al, ", "), ",", 2)[0], "-", 2)[0]
	}
	active, err := h.svc.Active(r.Context(), uid, id)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	var enrollment any
	if active != nil {
		enrollment = programs.EnrollmentJSON(*active)
	}
	httpx.JSON(w, http.StatusOK, httpx.O("id", def.ID, "title", def.Title, "shape", def.Shape, "durationWeeks", def.DurationWeeks,
		"defaultTarget", def.DefaultTarget, "citations", def.Citations, "disclaimer", def.Disclaimer,
		"body", def.BodyFor(locale), "activeEnrollment", enrollment))
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

func (h handlers) patchSettings(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	body, err := httpx.ReadJSON(r)
	var parsed any
	if err == nil {
		parsed, err = zod.Parse(settingsPatch, body)
	}
	var zerr *zod.Error
	if errors.As(err, &zerr) {
		httpx.ValidationError(w, zerr)
		return
	}
	if err != nil {
		httpx.Internal(w)
		return
	}
	s, err := h.svc.UpdateSettings(r.Context(), uid, parsed.(map[string]any))
	if err != nil {
		httpx.Internal(w)
		return
	}
	httpx.JSON(w, http.StatusOK, s.JSON())
}

func (h handlers) enrollments(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	rows, err := h.svc.List(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	out := []any{}
	for _, row := range rows {
		out = append(out, programs.EnrollmentJSON(row))
	}
	httpx.JSON(w, http.StatusOK, httpx.O("enrollments", out))
}

func (h handlers) recommendations(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	recs, err := h.svc.Recommendations(r.Context(), uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("recommendations", recs))
}

func (h handlers) dismiss(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	if err := h.svc.Dismiss(r.Context(), uid, chi.URLParam(r, "programId")); err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}

func (h handlers) enroll(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	fail := func(err error) {
		var zerr *zod.Error
		if errors.As(err, &zerr) {
			httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Validation", "details", zerr.Issues))
			return
		}
		httpx.Error(w, http.StatusBadRequest, err.Error())
	}
	body, err := httpx.ReadJSON(r)
	var parsed any
	if err == nil {
		parsed, err = zod.Parse(enrollBody, body)
	}
	if err != nil {
		fail(err)
		return
	}
	zone, today, err := h.today(r, uid)
	if err != nil {
		fail(err)
		return
	}
	target := zod.Ordered(enrollBody, parsed).(zod.OrderedObject).Values["targetPayload"]
	row, err := h.svc.Enroll(r.Context(), uid, chi.URLParam(r, "programId"), target, zone, today)
	if err != nil {
		fail(err)
		return
	}
	httpx.JSON(w, http.StatusCreated, programs.EnrollmentJSON(row))
}

// status serves pause, resume and end: every failure is a 400 with the
// error's message, as `err instanceof Error ? err.message : 'Internal'`.
func (h handlers) status(next string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := h.gate(w, r)
		if !ok {
			return
		}
		body, err := httpx.ReadJSON(r)
		var parsed any
		if err == nil {
			parsed, err = zod.Parse(enrollmentBody, body)
		}
		var row q.ProgramEnrollment
		if err == nil {
			row, err = h.svc.SetStatus(r.Context(), uid, int64(parsed.(map[string]any)["enrollmentId"].(float64)), next)
		}
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error())
			return
		}
		httpx.JSON(w, http.StatusOK, programs.EnrollmentJSON(row))
	}
}

func (h handlers) progress(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "programId")
	active, err := h.svc.Active(r.Context(), uid, id)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if active == nil {
		httpx.Error(w, http.StatusNotFound, "No active enrollment")
		return
	}
	_, today, err := h.today(r, uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	summary, confidence, err := h.svc.Progress(r.Context(), uid, *active, today, id == "acute-med-timing")
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("enrollment", programs.EnrollmentJSON(*active), "summary", summary, "confidence", confidence))
}

func strp(m map[string]any, k string) *string {
	if v, ok := m[k].(string); ok {
		return &v
	}
	return nil
}

func (h handlers) sleepLog(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	body, err := httpx.ReadJSON(r)
	var parsed any
	if err == nil {
		parsed, err = zod.Parse(sleepLogBody, body)
	}
	if err == nil {
		m := parsed.(map[string]any)
		err = programs.RecordSleepAdherence(r.Context(), h.d.Q, uid, m["localDate"].(string), strp(m, "bedTimeLocal"), strp(m, "wakeTimeLocal"), "computed")
	}
	var zerr *zod.Error
	switch {
	case errors.As(err, &zerr):
		httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Validation", "details", zerr.Issues))
	case err != nil:
		httpx.Error(w, http.StatusInternalServerError, "Internal")
	default:
		httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
	}
}

func (h handlers) todayStatus(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	active, err := h.svc.Active(r.Context(), uid, "sleep-regularity")
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if active == nil {
		httpx.Error(w, http.StatusNotFound, "Not enrolled")
		return
	}
	_, today, err := h.today(r, uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	ymd := jsontime.YMD(today)
	row, err := h.d.Q.TodayAdherenceEvent(r.Context(), active.ID, &ymd)
	var signal, payload any
	switch {
	case err == nil:
		signal = row.Signal
		if len(row.Payload) > 0 {
			payload = row.Payload
		}
	case !isNoRows(err):
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("today", today, "signal", signal, "payload", payload))
}

func (h handlers) attack(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.gate(w, r)
	if !ok {
		return
	}
	n := jsx.ToNumber(chi.URLParam(r, "id"))
	if !jsx.IsFinite(n) {
		httpx.Error(w, http.StatusBadRequest, "Bad attack id")
		return
	}
	active, err := h.svc.Active(r.Context(), uid, "acute-med-timing")
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	if active == nil {
		httpx.Error(w, http.StatusNotFound, "Not enrolled")
		return
	}
	res, found, err := programs.AttackTiming(r.Context(), h.d.Q, uid, n, active.TargetPayload)
	if err != nil {
		// A fractional or out-of-range id failed in Postgres.
		httpx.Unhandled(w)
		return
	}
	if !found {
		httpx.Error(w, http.StatusNotFound, "Attack not found")
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
