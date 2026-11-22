// Package cycle serves /api/cycle/*.
package cycle

import (
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/cycle"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var (
	ymdPattern = `^\d{4}-\d{2}-\d{2}$`
	ymdRe      = regexp.MustCompile(ymdPattern)
	flows      = []string{"unspecified", "light", "medium", "heavy"}
	toggle     = zod.Object(zod.F("localDate", zod.String().Regex(ymdPattern)))
	upsert     = zod.Object(zod.F("localDate", zod.String().Regex(ymdPattern)), zod.F("bleeding", zod.Boolean()), zod.F("flow", zod.Optional(zod.Enum(flows...))))
	flowBody   = zod.Object(zod.F("localDate", zod.String().Regex(ymdPattern)), zod.F("flow", zod.Enum(flows...)))
	settings   = zod.Object(
		zod.F("enabled", zod.Optional(zod.Boolean())),
		zod.F("includeInExports", zod.Optional(zod.Boolean())),
		zod.F("privacyMode", zod.Optional(zod.Enum("local_only", "account_sync"))),
		zod.F("perimenstrualWindowStartDays", zod.Optional(zod.Number().Int())),
		zod.F("perimenstrualWindowEndDays", zod.Optional(zod.Number().Int())),
		zod.F("hormoneProfile", zod.Optional(zod.Enum("unknown", "none", "combined_pill", "progestin_only_pill", "hormonal_iud",
			"implant", "injection", "patch_ring", "hrt", "other", "prefer_not_to_say"))),
	)
)

type handlers struct {
	d   *app.Deps
	svc *cycle.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &cycle.Service{Q: d.Q, Now: d.Clock}}
	r.Post("/api/cycle/bleeding", h.toggle)
	r.Put("/api/cycle/bleeding", h.upsert)
	r.Patch("/api/cycle/bleeding", h.flow)
	r.Delete("/api/cycle/bleeding", h.deleteDay)
	r.Get("/api/cycle/calendar", h.calendar)
	r.Get("/api/cycle/context", h.context)
	r.Delete("/api/cycle/data", h.deleteAll)
	r.Get("/api/cycle/insights", h.insights)
	r.Get("/api/cycle/settings", h.getSettings)
	r.Put("/api/cycle/settings", h.putSettings)
}

func user(w http.ResponseWriter, r *http.Request) string {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
	}
	return uid
}

// body parses the request like `Schema.parse(await request.json())` inside a
// try whose catch maps ZodError to 400 and anything else to failMsg.
func body(w http.ResponseWriter, r *http.Request, s zod.Schema, dst any, failMsg string) bool {
	raw, err := httpx.ReadJSON(r)
	if err == nil {
		err = zod.ParseInto(s, raw, dst)
	}
	var zerr *zod.Error
	switch {
	case err == nil:
		return true
	case errors.As(err, &zerr):
		httpx.ValidationError(w, zerr)
	default:
		httpx.Error(w, http.StatusInternalServerError, failMsg)
	}
	return false
}

func (h handlers) toggle(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	var in struct{ LocalDate string }
	if !body(w, r, toggle, &in, "Failed to toggle bleeding day") {
		return
	}
	day, err := h.svc.ToggleDay(r.Context(), uid, in.LocalDate)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to toggle bleeding day")
		return
	}
	httpx.JSON(w, http.StatusOK, day)
}

func (h handlers) upsert(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	var in struct {
		LocalDate string
		Bleeding  bool
		Flow      string
	}
	if !body(w, r, upsert, &in, "Failed to save bleeding day") {
		return
	}
	day, err := h.svc.SetDay(r.Context(), uid, in.LocalDate, in.Bleeding, in.Flow)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to save bleeding day")
		return
	}
	httpx.JSON(w, http.StatusOK, day)
}

func (h handlers) flow(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	var in struct{ LocalDate, Flow string }
	if !body(w, r, flowBody, &in, "Failed to update flow") {
		return
	}
	day, err := h.svc.SetFlow(r.Context(), uid, in.LocalDate, in.Flow)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to update flow")
		return
	}
	httpx.JSON(w, http.StatusOK, day)
}

func (h handlers) deleteDay(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	ymd := r.URL.Query().Get("localDate")
	if !ymdRe.MatchString(ymd) {
		httpx.Error(w, http.StatusBadRequest, "Invalid localDate")
		return
	}
	if err := h.svc.DeleteDay(r.Context(), uid, ymd); err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}

func (h handlers) calendar(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	qp := r.URL.Query()
	from, to := qp.Get("from"), qp.Get("to")
	if from == "" || to == "" {
		httpx.Error(w, http.StatusBadRequest, "from and to are required")
		return
	}
	res, err := h.svc.Calendar(r.Context(), uid, from, to)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) context(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	date := r.URL.Query().Get("date")
	if !ymdRe.MatchString(date) {
		httpx.Error(w, http.StatusBadRequest, "Invalid date")
		return
	}
	res, err := h.svc.Context(r.Context(), uid, date)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) deleteAll(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	if err := h.svc.DeleteAll(r.Context(), uid); err != nil {
		httpx.Unhandled(w)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true))
}

func (h handlers) insights(w http.ResponseWriter, r *http.Request) {
	uid := user(w, r)
	if uid == "" {
		return
	}
	zone, err := usertz.Get(r.Context(), h.d.Q, uid)
	if err != nil {
		httpx.Unhandled(w)
		return
	}
	defFrom, defTo := h.svc.DefaultRange(zone)
	qp := r.URL.Query()
	from, to := defFrom, defTo
	if v, ok := qp["from"]; ok {
		from = v[0]
	}
	if v, ok := qp["to"]; ok {
		to = v[0]
	}
	res, err := h.svc.Insights(r.Context(), uid, from, to)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
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
	raw, err := httpx.ReadJSON(r)
	var p cycle.SettingsPatch
	if err == nil {
		err = zod.ParseInto(settings, raw, &p)
	}
	var zerr *zod.Error
	if errors.As(err, &zerr) {
		httpx.ValidationError(w, zerr)
		return
	}
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, jsonErrorMessage(err))
		return
	}
	s, err := h.svc.UpsertSettings(r.Context(), uid, p)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, s.JSON())
}

// jsonErrorMessage approximates the SyntaxError text `request.json()` threw.
func jsonErrorMessage(err error) string {
	var bad httpx.ErrInvalidJSON
	if errors.As(err, &bad) {
		return "Unexpected end of JSON input"
	}
	return err.Error()
}
