package user_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/user"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
)

// clerkEnv mounts the routes with a fake Clerk Backend API answering status.
func clerkEnv(t *testing.T, status int) (*apitest.Env, *atomic.Value) {
	var deleted atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodDelete, r.Method)
		require.Equal(t, "Bearer sk_test", r.Header.Get("Authorization"))
		deleted.Store(r.URL.Path)
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		d.Clerk = auth.NewClerk("sk_test", "pk_test")
		d.Clerk.APIURL = srv.URL
		r := chi.NewRouter()
		user.Mount(r, d)
		return r
	})
	return e, &deleted
}

func TestExportRequiresAuthAndAValidFormat(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, 401, e.Do(apitest.Request{Path: "/api/user/export"}).Status)
	for _, f := range []string{"xml", "", "JSON"} {
		res := e.Do(apitest.Request{Path: "/api/user/export?format=" + f, User: "u1"})
		require.Equal(t, 400, res.Status, f)
		require.JSONEq(t, `{"error":"Invalid format. Use json or csv."}`, string(res.Body))
		require.Empty(t, res.Header.Get("Cache-Control"))
	}
}

func TestExportJSONAndCSV(t *testing.T) {
	e := newEnv(t)
	e.Exec(`INSERT INTO "user" (id, display_name) VALUES ('u1', 'Me'), ('u2', 'Other')`)
	e.Exec(`INSERT INTO community_post (author_id, title, body) VALUES ('u1', 'mine', 'b'), ('u2', 'theirs', 'b')`)

	res := e.Do(apitest.Request{Path: "/api/user/export", User: "u1"})
	require.Equal(t, 200, res.Status)
	require.Equal(t, "application/json; charset=utf-8", res.Header.Get("Content-Type"))
	require.Equal(t, "no-store, private", res.Header.Get("Cache-Control"))
	require.Equal(t, "nosniff", res.Header.Get("X-Content-Type-Options"))
	require.Regexp(t, `^attachment; filename="migraine-club-export-\d{4}-\d{2}-\d{2}\.json"$`, res.Header.Get("Content-Disposition"))
	body := string(res.Body)
	require.Contains(t, body, `"title": "mine"`)
	require.NotContains(t, body, "theirs")
	require.NotContains(t, body, "Other")

	res = e.Do(apitest.Request{Path: "/api/user/export?format=csv", User: "u1"})
	require.Equal(t, 200, res.Status)
	require.Equal(t, "application/zip", res.Header.Get("Content-Type"))
	require.Regexp(t, `-csv\.zip"$`, res.Header.Get("Content-Disposition"))
	require.True(t, strings.HasPrefix(string(res.Body), "PK\x03\x04"))
}

func TestDeleteAccount(t *testing.T) {
	e, deleted := clerkEnv(t, 200)
	require.Equal(t, 401, e.Do(apitest.Request{Method: "DELETE", Path: "/api/user/delete-account"}).Status)

	e.Exec(`INSERT INTO "user" (id) VALUES ('u1'), ('u2')`)
	for _, u := range []string{"u1", "u2"} {
		e.Exec(`INSERT INTO episode (user_id, start_time, intensity, pain_location, pain_type) VALUES ($1, now(), 3, 'left', 'throbbing')`, u)
		e.Exec(`INSERT INTO user_consent (user_id, consent_type, version) VALUES ($1, 'terms', '1.0')`, u)
		e.Exec(`INSERT INTO community_post (author_id, title, body) VALUES ($1, 't', 'b')`, u)
		e.Exec(`INSERT INTO user_weather_settings (user_id, lat, lon, timezone) VALUES ($1, 1, 2, 'UTC')`, u)
	}

	res := e.Do(apitest.Request{Method: "DELETE", Path: "/api/user/delete-account", User: "u1"})
	require.Equal(t, 200, res.Status)
	require.Equal(t, `{"success":true,"message":"Account and all associated data have been deleted"}`, string(res.Body))
	require.Equal(t, "/v1/users/u1", deleted.Load())

	for _, sql := range []string{
		`SELECT count(*) FROM "user" WHERE id = $1`,
		`SELECT count(*) FROM episode WHERE user_id = $1`,
		`SELECT count(*) FROM community_post WHERE author_id = $1`,
		`SELECT count(*) FROM user_weather_settings WHERE user_id = $1`,
		`SELECT count(*) FROM user_consent WHERE user_id = $1 AND withdrawn_at IS NULL`,
	} {
		require.Equal(t, 0, e.Count(sql, "u1"), sql)
		require.Equal(t, 1, e.Count(sql, "u2"), sql)
	}
	// Consents are kept as a withdrawn record.
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_consent WHERE user_id = 'u1' AND withdrawn_at IS NOT NULL`))
}

func TestDeleteAccountSucceedsWhenClerkFails(t *testing.T) {
	e, deleted := clerkEnv(t, 500)
	e.Exec(`INSERT INTO "user" (id) VALUES ('u1')`)
	res := e.Do(apitest.Request{Method: "DELETE", Path: "/api/user/delete-account", User: "u1"})
	require.Equal(t, 200, res.Status)
	require.Equal(t, "/v1/users/u1", deleted.Load())
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM "user" WHERE id = 'u1'`))
}
