package server

import (
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// requestLog writes one line per request: method, route, status, size and
// duration, the client's network (the address with its last part zeroed)
// and user agent. It never logs query strings, bodies or user ids, and
// replaces path segments that look like tokens or ids (share links carry a
// secret in the path). Health checks and the hashed bundles are left out:
// they are most of the volume and say nothing.
func requestLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/healthz" || strings.HasPrefix(r.URL.Path, "/assets/") {
				next.ServeHTTP(w, r)
				return
			}
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			status := ww.Status()
			if status == 0 {
				status = http.StatusOK
			}
			level := slog.LevelInfo
			if status >= 500 {
				level = slog.LevelError
			}
			log.Log(r.Context(), level, "request",
				"method", r.Method,
				"path", logPath(r),
				"status", status,
				"bytes", ww.BytesWritten(),
				"ms", time.Since(start).Milliseconds(),
				"net", clientNetwork(r),
				"ua", truncate(r.UserAgent(), 160),
			)
		})
	}
}

// secretSegment is a path segment that may identify a person or grant
// access: long tokens, UUIDs and numeric ids.
var secretSegment = regexp.MustCompile(`^(?:[A-Za-z0-9_-]{20,}|[0-9a-fA-F-]{32,36}|[0-9]+)$`)

// logPath is the matched route pattern (/api/share/{token}) or, for pages,
// the path with secret-looking segments replaced.
func logPath(r *http.Request) string {
	if rc := chi.RouteContext(r.Context()); rc != nil {
		if p := rc.RoutePattern(); p != "" && p != "/*" {
			return p
		}
	}
	segs := strings.Split(r.URL.Path, "/")
	for i, s := range segs {
		if secretSegment.MatchString(s) {
			segs[i] = ":id"
		}
	}
	return truncate(strings.Join(segs, "/"), 200)
}

// clientNetwork is the first X-Forwarded-For address with its host part
// dropped (IPv4 /24, IPv6 /48): enough to see a scanner, not a person.
func clientNetwork(r *http.Request) string {
	raw, _, _ := strings.Cut(r.Header.Get("X-Forwarded-For"), ",")
	ip := net.ParseIP(strings.TrimSpace(raw))
	if ip == nil {
		return ""
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.Mask(net.CIDRMask(24, 32)).String() + "/24"
	}
	return ip.Mask(net.CIDRMask(48, 128)).String() + "/48"
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
