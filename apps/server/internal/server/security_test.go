package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	require.Empty(t, https.Get("Content-Security-Policy"), "the policy only reports until its sources are confirmed")
	for _, d := range []string{"default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "report-uri /api/csp-report"} {
		require.Contains(t, csp, d)
	}

	require.Empty(t, get("http").Get("Strict-Transport-Security"), "HSTS only over HTTPS (local development)")
	require.Empty(t, get("").Get("Strict-Transport-Security"))
}

// A handler's own value wins (the uploads set their own nosniff).
func TestSecurityHeadersKeepHandlerValues(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.WriteHeader(http.StatusNoContent)
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/share/x", nil))
	require.Equal(t, "no-referrer", w.Header().Get("Referrer-Policy"))
	require.True(t, strings.HasPrefix(w.Header().Get("Content-Security-Policy-Report-Only"), "default-src"))
}
