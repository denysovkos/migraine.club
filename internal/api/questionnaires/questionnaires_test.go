package questionnaires_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/questionnaires"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		questionnaires.Mount(r, d)
		return r
	})
	e.Deps.Now = func() time.Time { return time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC) }
	fixture.User(t, e.Deps.Pool, "u")
	fixture.User(t, e.Deps.Pool, "other")
	return e
}

func post(e *apitest.Env, user string, body map[string]any) apitest.Response {
	return e.Do(apitest.Request{Method: "POST", Path: "/api/questionnaires", User: user, Body: body})
}

func TestCreateAndList(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, 401, e.Do(apitest.Request{Path: "/api/questionnaires"}).Status)

	res := post(e, "u", map[string]any{"type": "HIT6", "takenAt": "2026-01-02T03:04:05.123456Z",
		"answers": map[string]any{"q1": "NEVER", "q2": "RARELY", "q3": "SOMETIMES", "q4": "VERY_OFTEN", "q5": "ALWAYS", "q6": "NEVER", "extra": 1}})
	require.Equal(t, 201, res.Status, string(res.Body))
	m := res.Map(t)
	require.Equal(t, float64(54), m["scoreTotal"])
	require.Nil(t, m["scoreDetails"])
	require.Equal(t, "2026-01-02T03:04:05.123Z", m["takenAt"])
	require.NotContains(t, m["answers"], "extra")

	// MIDAS without a full window gets the 90 days before takenAt.
	m = post(e, "u", map[string]any{"type": "MIDAS", "periodStart": "2026-01-01T00:00:00Z",
		"answers": map[string]any{"q1": 1, "q2": 2, "q3": 3, "q4": 4, "q5": 12}}).Map(t)
	require.Equal(t, float64(22), m["scoreTotal"])
	require.Equal(t, map[string]any{"grade": "Grade IV"}, m["scoreDetails"])
	require.Equal(t, "2026-03-01T12:00:00.000Z", m["periodEnd"])
	require.Equal(t, "2025-12-01T12:00:00.000Z", m["periodStart"])

	post(e, "other", map[string]any{"type": "MIDAS", "answers": map[string]any{"q1": 0, "q2": 0, "q3": 0, "q4": 0, "q5": 0}})

	list := e.Do(apitest.Request{Path: "/api/questionnaires", User: "u"}).Map(t)["responses"].([]any)
	require.Len(t, list, 2)
	require.Equal(t, "MIDAS", list[0].(map[string]any)["type"]) // newest takenAt first
	only := e.Do(apitest.Request{Path: "/api/questionnaires?type=HIT6&limit=1", User: "u"}).Map(t)["responses"].([]any)
	require.Len(t, only, 1)
}

func TestValidation(t *testing.T) {
	e := newEnv(t)
	res := post(e, "u", map[string]any{"type": "PHQ9", "answers": map[string]any{}})
	require.Equal(t, 400, res.Status)
	res = post(e, "u", map[string]any{"type": "MIDAS", "answers": map[string]any{"q1": -1}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, "Validation error", res.Map(t)["error"])
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/questionnaires", User: "u", Raw: "{x"})
	require.Equal(t, `{"error":"Internal server error"}`, string(res.Body))
	require.Equal(t, 400, e.Do(apitest.Request{Path: "/api/questionnaires?limit=0", User: "u"}).Status)
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM questionnaire_responses`))
}
