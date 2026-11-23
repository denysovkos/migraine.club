package user_test

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/user"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
)

func newEnv(t *testing.T) *apitest.Env {
	return apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		user.Mount(r, d)
		return r
	})
}

func TestConsentRequiresAuth(t *testing.T) {
	e := newEnv(t)
	for _, m := range []string{"GET", "POST", "DELETE"} {
		res := e.Do(apitest.Request{Method: m, Path: "/api/user/consent?type=terms", Body: map[string]any{"consentType": "terms"}})
		require.Equal(t, 401, res.Status, m)
		require.JSONEq(t, `{"error":"Unauthorized"}`, string(res.Body))
	}
}

func TestConsentLifecycle(t *testing.T) {
	e := newEnv(t)

	res := e.Do(apitest.Request{Path: "/api/user/consent", User: "u1"})
	require.Equal(t, 200, res.Status)
	require.Equal(t, `{"consents":{}}`, string(res.Body))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/user/consent", User: "u1",
		Body:    map[string]any{"consentType": "health_data"},
		Headers: map[string]string{"X-Forwarded-For": "203.0.113.7, 10.0.0.1", "User-Agent": "UA/1"}})
	require.Equal(t, 201, res.Status)
	created := res.Map(t)
	require.Equal(t, "health_data", created["consentType"])
	require.Equal(t, "1.0", created["version"])
	require.Equal(t, "203.0.113.7", created["ipAddress"])
	require.Equal(t, "UA/1", created["userAgent"])
	require.Nil(t, created["withdrawnAt"])
	require.Regexp(t, `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`, created["givenAt"])
	// Full row, keys in Drizzle's order.
	require.Regexp(t, `^\{"id":"[^"]+","userId":"u1","consentType":"health_data","version":"1.0","givenAt":"[^"]+","withdrawnAt":null,"ipAddress":"203.0.113.7","userAgent":"UA/1","createdAt":"[^"]+","updatedAt":"[^"]+"\}$`, string(res.Body))

	// Giving the same consent again renews it in place (200, same id).
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/user/consent", User: "u1",
		Body: map[string]any{"consentType": "health_data", "version": "2.0"}})
	require.Equal(t, 200, res.Status)
	require.Equal(t, created["id"], res.Map(t)["id"])
	require.Equal(t, "2.0", res.Map(t)["version"])
	require.Equal(t, "unknown", res.Map(t)["ipAddress"])

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/user/consent", User: "u1", Body: map[string]any{"consentType": "terms"}})
	require.Equal(t, 201, res.Status)

	res = e.Do(apitest.Request{Path: "/api/user/consent", User: "u1"})
	consents := res.Map(t)["consents"].(map[string]any)
	require.Len(t, consents, 2)
	require.Equal(t, "2.0", consents["health_data"].(map[string]any)["version"])

	res = e.Do(apitest.Request{Method: "DELETE", Path: "/api/user/consent?type=terms", User: "u1"})
	require.Equal(t, 200, res.Status)
	require.Equal(t, `{"success":true}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "DELETE", Path: "/api/user/consent?type=terms", User: "u1"})
	require.Equal(t, 404, res.Status)
	require.Equal(t, `{"error":"No active consent found"}`, string(res.Body))

	res = e.Do(apitest.Request{Path: "/api/user/consent", User: "u1"})
	require.Len(t, res.Map(t)["consents"], 1)
}

func TestConsentValidation(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/user/consent", User: "u1", Body: map[string]any{"consentType": "marketing"}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"Validation error","details":[{"code":"invalid_value","values":["health_data","terms","privacy","analytics"],"path":["consentType"],"message":"Invalid option: expected one of \"health_data\"|\"terms\"|\"privacy\"|\"analytics\""}]}`, string(res.Body))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/user/consent", User: "u1", Raw: "{not json"})
	require.Equal(t, 500, res.Status)

	for _, q := range []string{"", "?type=", "?type=marketing"} {
		res = e.Do(apitest.Request{Method: "DELETE", Path: "/api/user/consent" + q, User: "u1"})
		require.Equal(t, 400, res.Status)
		require.Equal(t, `{"error":"Invalid consent type"}`, string(res.Body))
	}
}

func TestConsentIsPerUser(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/user/consent", User: "alice", Body: map[string]any{"consentType": "privacy"}})
	require.Equal(t, 201, res.Status)

	res = e.Do(apitest.Request{Path: "/api/user/consent", User: "bob"})
	require.Equal(t, `{"consents":{}}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "DELETE", Path: "/api/user/consent?type=privacy", User: "bob"})
	require.Equal(t, 404, res.Status)
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_consent WHERE user_id = 'alice' AND withdrawn_at IS NULL`))
}
