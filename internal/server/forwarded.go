package server

import (
	"net"
	"net/http"
)

// forwardedHeaders fills in x-forwarded-* the way Next's base server did
// before every handler ran, so handlers that read them (consent audit IPs,
// the MCP resource URL) see the same values.
func forwardedHeaders(port string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header
			proto := h.Get("X-Forwarded-Proto")
			isHTTPS := proto == "https" || (proto == "" && r.TLS != nil)
			setIfMissing(h, "X-Forwarded-Host", r.Host)
			if port != "" {
				setIfMissing(h, "X-Forwarded-Port", port)
			} else if isHTTPS {
				setIfMissing(h, "X-Forwarded-Port", "443")
			} else {
				setIfMissing(h, "X-Forwarded-Port", "80")
			}
			if isHTTPS {
				setIfMissing(h, "X-Forwarded-Proto", "https")
			} else {
				setIfMissing(h, "X-Forwarded-Proto", "http")
			}
			if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
				setIfMissing(h, "X-Forwarded-For", host)
			}
			next.ServeHTTP(w, r)
		})
	}
}

func setIfMissing(h http.Header, k, v string) {
	if _, ok := h[k]; !ok {
		h.Set(k, v)
	}
}
