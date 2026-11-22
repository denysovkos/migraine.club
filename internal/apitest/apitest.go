// Package apitest runs handlers against a real, migrated test database.
package apitest

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/config"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

// Env is a handler under test with its database.
type Env struct {
	T       testing.TB
	Deps    *app.Deps
	Handler http.Handler
}

// New builds deps on a fresh database. mount registers the routes under test.
func New(t testing.TB, mount func(*app.Deps) http.Handler) *Env {
	t.Helper()
	pool := testdb.New(t)
	d := &app.Deps{
		Cfg:   &config.Config{E2EMockAuth: true, BillingPlanEnv: "test"},
		Pool:  pool,
		Q:     q.New(pool),
		Users: auth.MockUsers{},
		Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		HTTP:  &http.Client{Timeout: 5 * time.Second},
		Now:   time.Now,
	}
	return &Env{T: t, Deps: d, Handler: auth.Middleware(headerResolver{})(mount(d))}
}

// headerResolver signs requests in as the user in the test header, or not at all.
type headerResolver struct{}

const userHeader = "X-Test-User"

func (headerResolver) SessionUserID(r *http.Request) string { return r.Header.Get(userHeader) }

// Response is a recorded response.
type Response struct {
	Status int
	Header http.Header
	Body   []byte
}

// JSON decodes the body into a generic value.
func (r Response) JSON(t testing.TB) any {
	t.Helper()
	var v any
	require.NoError(t, json.Unmarshal(r.Body, &v), string(r.Body))
	return v
}

// Map decodes the body as an object.
func (r Response) Map(t testing.TB) map[string]any {
	t.Helper()
	m, ok := r.JSON(t).(map[string]any)
	require.True(t, ok, string(r.Body))
	return m
}

// Request describes one call.
type Request struct {
	Method  string
	Path    string
	User    string
	Body    any
	Raw     string
	Headers map[string]string
}

// Do performs a request.
func (e *Env) Do(req Request) Response {
	e.T.Helper()
	var body io.Reader
	switch {
	case req.Raw != "":
		body = bytes.NewBufferString(req.Raw)
	case req.Body != nil:
		b, err := json.Marshal(req.Body)
		require.NoError(e.T, err)
		body = bytes.NewReader(b)
	}
	method := req.Method
	if method == "" {
		method = http.MethodGet
	}
	r := httptest.NewRequest(method, req.Path, body)
	if req.User != "" {
		r.Header.Set(userHeader, req.User)
	}
	for k, v := range req.Headers {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	e.Handler.ServeHTTP(rec, r)
	return Response{Status: rec.Code, Header: rec.Header(), Body: rec.Body.Bytes()}
}

// Exec runs SQL to arrange state.
func (e *Env) Exec(sql string, args ...any) {
	e.T.Helper()
	_, err := e.Deps.Pool.Exec(e.T.Context(), sql, args...)
	require.NoError(e.T, err)
}

// Count returns SELECT count(*) for a query.
func (e *Env) Count(sql string, args ...any) int {
	e.T.Helper()
	var n int
	require.NoError(e.T, e.Deps.Pool.QueryRow(e.T.Context(), sql, args...).Scan(&n))
	return n
}
