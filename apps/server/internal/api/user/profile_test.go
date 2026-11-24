package user_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/apitest"
)

func TestProfileGetCreatesTheRecord(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Path: "/api/user/profile", User: "user_new", Headers: map[string]string{"Accept-Language": "uk-UA,en;q=0.5"}})
	require.Equal(t, 200, res.Status)
	// The mock Clerk user is "E2E User".
	require.Regexp(t, `^\{"id":"user_new","displayName":"E2E User","preferredLanguage":"uk","themePreference":"light","isDoctor":false,"isDoctorVerified":false,"createdAt":"[^"]+Z","updatedAt":"[^"]+Z"\}$`, string(res.Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM "user" WHERE id = 'user_new'`))

	// An existing record is returned as is.
	e.Exec(`UPDATE "user" SET display_name = 'Kept', preferred_language = 'fr' WHERE id = 'user_new'`)
	res = e.Do(apitest.Request{Path: "/api/user/profile", User: "user_new"})
	require.Equal(t, "Kept", res.Map(t)["displayName"])
	require.Equal(t, "fr", res.Map(t)["preferredLanguage"])

	// A record with an empty name gets one.
	e.Exec(`UPDATE "user" SET display_name = '' WHERE id = 'user_new'`)
	res = e.Do(apitest.Request{Path: "/api/user/profile", User: "user_new"})
	require.Equal(t, "E2E User", res.Map(t)["displayName"])
}

func TestProfileUpdate(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, 200, e.Do(apitest.Request{Path: "/api/user/profile", User: "u2"}).Status)

	res := e.Do(apitest.Request{Method: "PUT", Path: "/api/user/profile", User: "u2",
		Body: map[string]any{"displayName": "  Migraine Warrior  ", "themePreference": "dark", "preferredLanguage": "fr"}})
	require.Equal(t, 200, res.Status)
	m := res.Map(t)
	require.Equal(t, "Migraine Warrior", m["displayName"])
	require.Equal(t, "dark", m["themePreference"])
	require.Equal(t, "fr", m["preferredLanguage"])

	// Nothing to change returns the profile unchanged.
	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/user/profile", User: "u2", Body: map[string]any{}})
	require.Equal(t, 200, res.Status)
	require.Equal(t, "Migraine Warrior", res.Map(t)["displayName"])
}

func TestProfileUpdateValidation(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, 200, e.Do(apitest.Request{Path: "/api/user/profile", User: "u3"}).Status)

	res := e.Do(apitest.Request{Method: "PUT", Path: "/api/user/profile", User: "u3",
		Body: map[string]any{"themePreference": "system", "displayName": "x"}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"Validation failed","details":{"displayName":["Display name must be at least 2 characters"],"themePreference":["Invalid option: expected one of \"light\"|\"dark\""]}}`, string(res.Body))

	// Passes zod (2+ chars) but is blank once trimmed.
	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/user/profile", User: "u3", Body: map[string]any{"displayName": "   "}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"Invalid display name"}`, string(res.Body))

	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/user/profile", User: "u3", Raw: "nope"})
	require.Equal(t, 500, res.Status)
	require.Equal(t, `{"error":"Failed to update profile"}`, string(res.Body))
}

func TestProfileNotFoundAndIsolation(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "PUT", Path: "/api/user/profile", User: "ghost", Body: map[string]any{"themePreference": "dark"}})
	require.Equal(t, 404, res.Status)
	require.Equal(t, `{"error":"Profile not found"}`, string(res.Body))

	require.Equal(t, 200, e.Do(apitest.Request{Path: "/api/user/profile", User: "alice"}).Status)
	e.Do(apitest.Request{Method: "PUT", Path: "/api/user/profile", User: "alice", Body: map[string]any{"themePreference": "dark"}})
	res = e.Do(apitest.Request{Path: "/api/user/profile", User: "bob"})
	require.Equal(t, "light", res.Map(t)["themePreference"])
	require.Equal(t, 401, e.Do(apitest.Request{Path: "/api/user/profile"}).Status)
}
