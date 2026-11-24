package server

import (
	"net/http"
	"strings"
)

// contentSecurityPolicy is reported, not enforced, until the reports at
// /api/csp-report show every source the app really loads (Clerk, the
// analytics script, geocoding). Enforcing a guess could break sign-in.
var contentSecurityPolicy = strings.Join([]string{
	"default-src 'self'",
	"script-src 'self' https://migraine.club https://*.clerk.accounts.dev https://clerk.migraine.club https://challenges.cloudflare.com",
	"connect-src 'self' https://migraine.club https://*.clerk.accounts.dev https://clerk.migraine.club https://nominatim.openstreetmap.org",
	"img-src 'self' data: blob: https://img.clerk.com",
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self' data:",
	"frame-src https://challenges.cloudflare.com https://*.clerk.accounts.dev https://clerk.migraine.club",
	"worker-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"report-uri /api/csp-report",
}, "; ")

// securityHeaders adds the browser protections to every response. Values a
// handler sets itself are kept.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		set := func(k, v string) {
			if h.Get(k) == "" {
				h.Set(k, v)
			}
		}
		set("X-Content-Type-Options", "nosniff")
		// Nothing embeds the app; framing it only enables clickjacking.
		set("X-Frame-Options", "DENY")
		set("Referrer-Policy", "strict-origin-when-cross-origin")
		// Geolocation fills in the weather location; nothing else is used.
		set("Permissions-Policy", "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)")
		set("Content-Security-Policy-Report-Only", contentSecurityPolicy)
		// Over HTTPS only, so local development on http:// is unaffected.
		// No includeSubDomains: other subdomains are not ours to promise.
		if r.Header.Get("X-Forwarded-Proto") == "https" || r.TLS != nil {
			set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}
