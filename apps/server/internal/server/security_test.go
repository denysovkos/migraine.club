package server

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/cspnonce"
)

func TestSecurityHeaders(t *testing.T) {
	var seen string
	h := securityHeaders(false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = cspnonce.From(r.Context())
		_, _ = w.Write([]byte("ok"))
	}))
	get := func(proto string) http.Header {
		req := httptest.NewRequest(http.MethodGet, "/dashboard", nil)
		if proto != "" {
			req.Header.Set("X-Forwarded-Proto", proto)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		require.Equal(t, "ok", w.Body.String())
		return w.Header()
	}

	https := get("https")
	require.Equal(t, "nosniff", https.Get("X-Content-Type-Options"))
	require.Equal(t, "DENY", https.Get("X-Frame-Options"))
	require.Equal(t, "strict-origin-when-cross-origin", https.Get("Referrer-Policy"))
	require.Equal(t, "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)", https.Get("Permissions-Policy"))
	require.Equal(t, "max-age=31536000", https.Get("Strict-Transport-Security"))

	csp := https.Get("Content-Security-Policy-Report-Only")
	require.Empty(t, https.Get("Content-Security-Policy"), "report-only unless CSP_ENFORCE")
	m := regexp.MustCompile(`script-src 'nonce-([A-Za-z0-9+/=]{24})' 'strict-dynamic' 'wasm-unsafe-eval' 'report-sample' https: 'unsafe-inline'`).FindStringSubmatch(csp)
	require.NotNil(t, m, csp)
	require.Equal(t, seen, m[1], "the handler gets the nonce the policy names")
	for _, d := range []string{"object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "report-uri /api/csp-report"} {
		require.Contains(t, csp, d)
	}
	require.NotContains(t, get("https").Get("Content-Security-Policy-Report-Only"), m[1], "a fresh nonce per request")

	require.Empty(t, get("http").Get("Strict-Transport-Security"), "HSTS only over HTTPS (local development)")
	require.Empty(t, get("").Get("Strict-Transport-Security"))
}

func TestSecurityHeadersEnforced(t *testing.T) {
	h := securityHeaders(true)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	require.Contains(t, w.Header().Get("Content-Security-Policy"), "'strict-dynamic'")
	require.Empty(t, w.Header().Get("Content-Security-Policy-Report-Only"))
}

// A handler's own value wins (the uploads set their own nosniff).
func TestSecurityHeadersKeepHandlerValues(t *testing.T) {
	h := securityHeaders(false)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.WriteHeader(http.StatusNoContent)
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/share/x", nil))
	require.Equal(t, "no-referrer", w.Header().Get("Referrer-Policy"))
}
