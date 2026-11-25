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

// To find what injects a script into production pages: a script from the
// site itself is logged with its path, and an inline one with the start of
// its code, which the policy asks for with 'report-sample'.
func TestCSPReportsNameSameOriginScriptsAndInlineSamples(t *testing.T) {
	var buf bytes.Buffer
	h := newCSPReports(slog.New(slog.NewTextHandler(&buf, nil)), time.Now)
	post := func(body string) string {
		buf.Reset()
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/csp-report", strings.NewReader(body)))
		return buf.String()
	}

	out := post(`{"csp-report":{"document-uri":"https://www.migraine.club/dashboard","effective-directive":"script-src-elem","blocked-uri":"https://www.migraine.club/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js?v=1"}}`)
	require.Contains(t, out, "blocked=https://www.migraine.club/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js")
	require.NotContains(t, out, "v=1")

	out = post(`{"csp-report":{"document-uri":"https://www.migraine.club/share/AbCdEfGhIjKlMnOpQrStUvWx","effective-directive":"script-src-elem","blocked-uri":"https://www.migraine.club/share/AbCdEfGhIjKlMnOpQrStUvWx/x.js"}}`)
	require.Contains(t, out, "blocked=https://www.migraine.club/share/:id/x.js", "tokens in the path are replaced")

	out = post(`{"csp-report":{"document-uri":"https://www.migraine.club/dashboard","effective-directive":"script-src-elem","blocked-uri":"https://other.example/a/b.js"}}`)
	require.Contains(t, out, "blocked=https://other.example ")

	out = post(`{"csp-report":{"document-uri":"https://www.migraine.club/","effective-directive":"script-src-elem","blocked-uri":"inline","script-sample":"(function(){window.__CF$cv$params={r:'8e2' and much more code"}}`)
	require.Contains(t, out, "blocked=inline")
	require.Contains(t, out, `sample="(function(){window.__CF$cv$params={r:'8e"`)

	out = post(`{"csp-report":{"document-uri":"https://www.migraine.club/dashboard","effective-directive":"script-src","blocked-uri":"eval","script-sample":"{\"note\":\"took ibuprofen\"}"}}`)
	require.Contains(t, out, "blocked=eval")
	require.NotContains(t, out, "ibuprofen", "eval'd code can carry data: no sample")

	out = post(`{"csp-report":{"document-uri":"https://www.migraine.club/","effective-directive":"script-src-elem","blocked-uri":"inline","script-sample":"(function(){window.__CF$cv$params={r:'8e2' and much more code"}}`)
	require.Empty(t, out, "the same inline script is logged once an hour")
}
