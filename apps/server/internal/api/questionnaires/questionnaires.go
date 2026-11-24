// Package questionnaires serves /api/questionnaires.
package questionnaires

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/questionnaires"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var (
	listQuery = zod.Object(
		zod.F("type", zod.Optional(zod.Enum(questionnaires.Types...))),
		zod.F("limit", zod.Default(zod.CoerceNumber().Int().Min(1).Max(200), 50.0)),
	)
	createSchema = zod.Object(
		zod.F("type", zod.Enum(questionnaires.Types...)),
		zod.F("takenAt", zod.Optional(zod.String().Datetime())),
		zod.F("periodStart", zod.Optional(zod.String().Datetime())),
		zod.F("periodEnd", zod.Optional(zod.String().Datetime())),
		zod.F("answers", zod.Unknown()),
	)
)

type handlers struct{ d *app.Deps }

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d}
	r.Get("/api/questionnaires", h.list)
	r.Post("/api/questionnaires", h.create)
}

// fail is the routes' catch: ZodError 400, anything else a generic 500.
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

func iso(t *jsontime.Time) any {
	if t == nil {
		return nil
	}
	return jsontime.Format(t.Time)
}

func dto(r q.QuestionnaireResponse) *httpx.Object {
	var score any
	if r.ScoreTotal != nil {
		score = *r.ScoreTotal
	}
	return httpx.O("id", r.ID, "type", r.Type, "takenAt", jsontime.Format(r.TakenAt.Time),
		"periodStart", iso(r.PeriodStart), "periodEnd", iso(r.PeriodEnd), "answers", r.Answers,
		"scoreTotal", score, "scoreDetails", r.ScoreDetails, "createdAt", jsontime.Format(r.CreatedAt.Time))
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	parsed, err := zod.Parse(listQuery, map[string]any{"type": param(r, "type"), "limit": param(r, "limit")})
	if err != nil {
		fail(w, err)
		return
	}
	m := parsed.(map[string]any)
	var kind *string
	if t, ok := m["type"].(string); ok && t != "" {
		kind = &t
	}
	rows, err := h.d.Q.ListQuestionnaireResponses(r.Context(), uid, kind, int32(m["limit"].(float64)))
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]any, len(rows))
	for i, row := range rows {
		out[i] = dto(row)
	}
	httpx.JSON(w, http.StatusOK, httpx.O("responses", out))
}

// jsDate is `new Date(iso)` for a string z.string().datetime() accepted.
func jsDate(m map[string]any, k string) *time.Time {
	s, ok := m[k].(string)
	if !ok || s == "" {
		return nil
	}
	t, err := jsontime.Parse(s)
	if err != nil {
		return nil
	}
	t = t.Truncate(time.Millisecond)
	return &t
}

func (h handlers) create(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(w, err)
		return
	}
	parsed, err := zod.Parse(createSchema, body)
	if err != nil {
		fail(w, err)
		return
	}
	m := parsed.(map[string]any)
	kind := m["type"].(string)
	takenAt := h.d.Clock().Truncate(time.Millisecond)
	if t := jsDate(m, "takenAt"); t != nil {
		takenAt = *t
	}
	start, end := jsDate(m, "periodStart"), jsDate(m, "periodEnd")
	if kind == "MIDAS" && (start == nil || end == nil) {
		s, e := takenAt.UTC().AddDate(0, 0, -90), takenAt
		start, end = &s, &e
	}
	answers, ok := m["answers"]
	if !ok {
		answers = zod.Undefined
	}
	scored, err := questionnaires.Score(kind, answers)
	if err != nil {
		fail(w, err)
		return
	}
	params := q.InsertQuestionnaireResponseParams{
		UserID: uid, Type: kind, TakenAt: jsontime.New(takenAt), Answers: mustJSON(scored.Answers), ScoreTotal: &scored.Total,
	}
	if start != nil {
		params.PeriodStart = jsontime.Ptr(*start)
	}
	if end != nil {
		params.PeriodEnd = jsontime.Ptr(*end)
	}
	if scored.Details != nil {
		params.ScoreDetails = mustJSON(scored.Details)
	}
	row, err := h.d.Q.InsertQuestionnaireResponse(r.Context(), params)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, dto(row))
}

func mustJSON(v any) []byte {
	b, _ := httpx.Marshal(v)
	return b
}
