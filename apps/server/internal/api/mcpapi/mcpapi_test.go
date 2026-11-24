package mcpapi_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/mcpapi"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
)

const writeToken = "Bearer e2e-mcp|%s|migraine:read,migraine:write|test-client"

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		d.Cfg.ClerkPublishableKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k"
		r := chi.NewRouter()
		mcpapi.Mount(r, d)
		return r
	})
	e.Exec(`INSERT INTO "user" (id, role) VALUES ('u1', 'user'), ('u2', 'user')`)
	e.Exec(`INSERT INTO user_consent (user_id, consent_type, version, given_at)
		SELECT u, c, '1', now() FROM unnest(ARRAY['u1', 'u2']) u, unnest(ARRAY['health_data', 'terms', 'privacy']) c`)
	return e
}

func call(e *apitest.Env, user, tool, args string) string {
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/mcp",
		Raw: fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, tool, args),
		Headers: map[string]string{"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
			"Authorization": fmt.Sprintf(writeToken, user)}})
	require.Equal(e.T, 200, res.Status, string(res.Body))
	return string(res.Body)
}

func TestToolsWriteAndIsolation(t *testing.T) {
	e := newEnv(t)
	out := call(e, "u1", "log_attack", `{"intensity":3}`)
	require.Contains(t, out, `Logged migraine at intensity 3/5 (attack id `)
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM episode WHERE user_id = 'u1' AND is_ongoing`))

	require.Contains(t, call(e, "u1", "get_user_context", `{}`), `An attack is ongoing`)
	require.Contains(t, call(e, "u2", "get_user_context", `{}`), `No attack is currently ongoing.`, "u2 never sees u1's attack")
	require.Contains(t, call(e, "u2", "list_attacks", `{}`), `0 attack(s) returned of 0 in range.`)

	var id int
	require.NoError(t, e.Deps.Pool.QueryRow(t.Context(), `SELECT id FROM episode WHERE user_id = 'u1'`).Scan(&id))
	other := call(e, "u2", "update_attack", fmt.Sprintf(`{"attackId":%d,"endNow":true}`, id))
	require.Contains(t, other, `\"code\": \"NOT_FOUND\"`)
	require.Contains(t, other, `"isError":true`)
	require.Contains(t, call(e, "u1", "update_attack", fmt.Sprintf(`{"attackId":%d,"endNow":true}`, id)), fmt.Sprintf(`Attack %d updated; ended `, id))

	require.Contains(t, call(e, "u1", "log_medication_dose", `{"medicationName":"  Sumatriptan "}`), `Logged as an acute dose`)
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u1' AND custom_name = 'Sumatriptan'`))
	require.Contains(t, call(e, "u2", "list_medication_doses", `{}`), `0 acute dose(s) in range.`)
	require.Contains(t, call(e, "u1", "log_medication_dose", `{}`), `\"code\": \"VALIDATION_ERROR\"`)

	require.Equal(t, 0, e.Count(`SELECT count(*) FROM mcp_tool_call_audit WHERE user_id = 'u1' AND outcome = 'error' AND error_code <> 'VALIDATION_ERROR'`))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM mcp_tool_call_audit WHERE user_id = 'u2' AND tool_name = 'update_attack' AND error_code = 'NOT_FOUND' AND client_id = 'test-client'`))
}

func TestMetadataRoutes(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Path: "/.well-known/oauth-protected-resource/mcp", Headers: map[string]string{"X-Forwarded-Host": "mcp.test"}})
	require.Equal(t, 200, res.Status)
	require.Equal(t, "*", res.Header.Get("Access-Control-Allow-Origin"))
	require.True(t, strings.HasPrefix(string(res.Body), `{"resource":"https://mcp.test/api/mcp","authorization_servers":["https://clerk.example.com"],`), string(res.Body))
	require.Contains(t, string(res.Body), `"scopes_supported":["migraine:read","migraine:write"]}`)

	res = e.Do(apitest.Request{Method: "OPTIONS", Path: "/.well-known/oauth-authorization-server"})
	require.Equal(t, 200, res.Status)
	require.Equal(t, "GET, OPTIONS", res.Header.Get("Access-Control-Allow-Methods"))
	require.Empty(t, res.Body)
}

func TestUnauthenticated(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/mcp", Raw: `{"jsonrpc":"2.0","id":1,"method":"ping"}`,
		Headers: map[string]string{"Content-Type": "application/json"}})
	require.Equal(t, 401, res.Status)
	require.Equal(t, `{"error":"invalid_token","error_description":"No authorization provided"}`, string(res.Body))
}
