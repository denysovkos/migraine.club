package factors_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/factors"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		factors.Mount(r, d)
		return r
	})
	for _, u := range []string{"u", "other"} {
		fixture.User(t, e.Deps.Pool, u)
		fixture.Consents(t, e.Deps.Pool, u)
	}
	return e
}

func TestLogAndOptions(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/factors/log", User: "u", Body: map[string]any{"displayName": " Stress ", "type": "trigger"}})
	require.Equal(t, 200, res.Status, string(res.Body))
	first := res.Map(t)
	require.Equal(t, true, first["ok"])
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/factors/log", User: "u", Body: map[string]any{"displayName": "Stress", "type": "trigger"}})
	require.Equal(t, first["factorId"], res.Map(t)["factorId"], "an active factor with the same name and type is reused")
	e.Do(apitest.Request{Method: "POST", Path: "/api/factors/log", User: "u", Body: map[string]any{"displayName": "Loud music", "type": "trigger"}})
	e.Do(apitest.Request{Method: "POST", Path: "/api/factors/log", User: "u", Body: map[string]any{"displayName": "Walk", "type": "protector",
		"occurredAt": time.Now().Add(-48 * time.Hour).UTC().Format(time.RFC3339)}})

	opt := e.Do(apitest.Request{Path: "/api/factors/options", User: "u"}).Map(t)
	trig := opt["trigger"].(map[string]any)
	stress := trig["builtIns"].([]any)[1].(map[string]any)
	require.Equal(t, map[string]any{"key": "stress", "type": "trigger", "translationKey": "builtins.trigger.stress", "logged": true}, stress)
	// "Stress" matches the built-in, so only the custom one is in recent.
	recent := trig["recent"].([]any)
	require.Len(t, recent, 1)
	require.Equal(t, "Loud music", recent[0].(map[string]any)["displayName"])
	prot := opt["protector"].(map[string]any)
	require.Len(t, prot["recent"], 1)
	require.Len(t, prot["builtIns"], 10)

	other := e.Do(apitest.Request{Path: "/api/factors/options", User: "other"}).Map(t)
	require.Empty(t, other["trigger"].(map[string]any)["recent"])

	require.Equal(t, `{"error":"Invalid localDate"}`, string(e.Do(apitest.Request{Path: "/api/factors/options?localDate=2026-02-30", User: "u"}).Body))
	require.Equal(t, 200, e.Do(apitest.Request{Path: "/api/factors/options?localDate=2026-02-28", User: "u"}).Status)

	// A body that fails validation was never caught: 500 with no body.
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/factors/log", User: "u", Body: map[string]any{"displayName": "", "type": "mood"}})
	require.Equal(t, 500, res.Status)
	require.Empty(t, res.Body)

	e.Exec(`UPDATE user_consent SET withdrawn_at = now() WHERE user_id = 'u' AND consent_type = 'terms'`)
	require.Equal(t, `{"error":"Health data consent required","code":"CONSENT_REQUIRED"}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/factors/log", User: "u", Body: map[string]any{"displayName": "x", "type": "symptom"}}).Body))
	require.Equal(t, 403, e.Do(apitest.Request{Path: "/api/factors/options", User: "u"}).Status)
	require.Equal(t, 401, e.Do(apitest.Request{Path: "/api/factors/options"}).Status)
}
