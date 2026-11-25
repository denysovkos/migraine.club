package server

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

func TestRequestLog(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, nil))
	r := chi.NewRouter()
	r.Use(requestLog(log))
	r.Get("/healthz", func(http.ResponseWriter, *http.Request) {})
	r.Get("/api/share/{token}", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("shared")) })
	r.Get("/api/boom", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) })
	r.NotFound(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) })

	do := func(path, xff string) map[string]any {
		buf.Reset()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("User-Agent", "test-agent")
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		r.ServeHTTP(httptest.NewRecorder(), req)
		if buf.Len() == 0 {
			return nil
		}
		var m map[string]any
		require.NoError(t, json.Unmarshal(buf.Bytes(), &m))
		return m
	}

	m := do("/api/share/AbCdEfGhIjKlMnOpQrStUvWx?x=secret", "203.0.113.77, 10.0.0.1")
	require.Equal(t, "request", m["msg"])
	require.Equal(t, "INFO", m["level"])
	require.Equal(t, "GET", m["method"])
	require.Equal(t, "/api/share/{token}", m["path"], "the route pattern, not the token")
	require.EqualValues(t, 200, m["status"])
	require.EqualValues(t, 6, m["bytes"])
	require.Equal(t, "203.0.113.0/24", m["net"])
	require.Equal(t, "test-agent", m["ua"])
	require.NotContains(t, buf.String(), "secret")
	require.NotContains(t, buf.String(), "AbCdEfGh")

	m = do("/share/AbCdEfGhIjKlMnOpQrStUvWx/print", "2001:db8:1234:5678::1")
	require.Equal(t, "/share/:id/print", m["path"], "pages: secret-looking segments are replaced")
	require.EqualValues(t, 404, m["status"])
	require.Equal(t, "2001:db8:1234::/48", m["net"])

	require.Equal(t, "/dashboard/episodes/:id", do("/dashboard/episodes/138", "")["path"])
	require.Equal(t, "/wp-login.php", do("/wp-login.php", "")["path"])

	m = do("/api/boom", "")
	require.Equal(t, "ERROR", m["level"])
	require.EqualValues(t, 500, m["status"])

	require.Nil(t, do("/healthz", ""), "health checks are not logged")
	require.Nil(t, do("/assets/index-abc.js", ""), "nor the hashed bundles")
	require.False(t, strings.Contains(buf.String(), "user"))
}

// The client went away before the answer: the handler's 500 is not the
// server's fault, so the line is INFO and marks the request as canceled.
func TestRequestLogCanceledByClient(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, nil))
	h := requestLog(log)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/intake", nil).WithContext(ctx))

	var m map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &m))
	require.Equal(t, "INFO", m["level"])
	require.Equal(t, true, m["canceled"])
	require.EqualValues(t, 500, m["status"])
}
