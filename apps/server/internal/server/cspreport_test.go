package server

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCSPReports(t *testing.T) {
	var buf bytes.Buffer
	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	h := newCSPReports(slog.New(slog.NewTextHandler(&buf, nil)), func() time.Time { return now })
	post := func(body string) int {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/csp-report", strings.NewReader(body)))
		return w.Code
	}
	report := `{"csp-report":{"document-uri":"https://www.migraine.club/share/AbCdEfGhIjKlMnOpQrStUvWx?x=1","violated-directive":"script-src-elem","effective-directive":"script-src-elem","blocked-uri":"https://evil.example/x.js?token=secret"}}`

	require.Equal(t, http.StatusNoContent, post(report))
	out := buf.String()
	require.Contains(t, out, "CSP violation")
	require.Contains(t, out, "directive=script-src-elem")
	require.Contains(t, out, "blocked=https://evil.example")
	require.Contains(t, out, "page=/share/:id")
	require.NotContains(t, out, "secret", "no query strings")
	require.NotContains(t, out, "AbCdEfGh", "no tokens")

	buf.Reset()
	require.Equal(t, http.StatusNoContent, post(report))
	require.Empty(t, buf.String(), "the same violation is logged once an hour")
	now = now.Add(61 * time.Minute)
	require.Equal(t, http.StatusNoContent, post(report))
	require.NotEmpty(t, buf.String())

	buf.Reset()
	require.Equal(t, http.StatusNoContent, post(`{"csp-report":{"violated-directive":"script-src 'self'","blocked-uri":"inline"}}`))
	require.Contains(t, buf.String(), "directive=script-src")
	require.Contains(t, buf.String(), "blocked=inline")

	require.Equal(t, http.StatusBadRequest, post(`nope`))
	require.Equal(t, http.StatusBadRequest, post(`{"csp-report":{}}`))
	require.Equal(t, http.StatusRequestEntityTooLarge, post(`{"csp-report":{"x":"`+strings.Repeat("a", 20<<10)+`"}}`))
}
