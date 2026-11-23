package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestForwardedHeadersLikeNext(t *testing.T) {
	var got http.Header
	h := forwardedHeaders("3000")(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = r.Header }))

	r := httptest.NewRequest("GET", "http://example.test/x", nil)
	r.RemoteAddr = "192.0.2.5:54321"
	h.ServeHTTP(httptest.NewRecorder(), r)
	require.Equal(t, "example.test", got.Get("X-Forwarded-Host"))
	require.Equal(t, "3000", got.Get("X-Forwarded-Port"))
	require.Equal(t, "http", got.Get("X-Forwarded-Proto"))
	require.Equal(t, "192.0.2.5", got.Get("X-Forwarded-For"))

	// Values set by the platform's proxy are kept.
	r = httptest.NewRequest("GET", "http://internal:10000/x", nil)
	r.Header.Set("X-Forwarded-For", "203.0.113.9")
	r.Header.Set("X-Forwarded-Proto", "https")
	r.Header.Set("X-Forwarded-Host", "migraine.club")
	h.ServeHTTP(httptest.NewRecorder(), r)
	require.Equal(t, "203.0.113.9", got.Get("X-Forwarded-For"))
	require.Equal(t, "https", got.Get("X-Forwarded-Proto"))
	require.Equal(t, "migraine.club", got.Get("X-Forwarded-Host"))
}
