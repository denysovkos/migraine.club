package server

import (
	"net/http"

	"github.com/denysovkos/migraine.club/internal/cspnonce"
)

// contentSecurityPolicy is a strict, nonce-based policy (the one Google
// recommends): the page's own scripts carry the request's nonce, and
// 'strict-dynamic' trusts the scripts they load (clerk-js, Tag Manager,
// the analytics script), so there is no list of script hosts to keep up
// with. 'unsafe-inline' and https: are only read by browsers too old for
// nonces. 'wasm-unsafe-eval' lets the PDF renderer compile its
// WebAssembly layout engine; eval itself stays blocked. It stops injected
// scripts, plugins and <base> hijacking; where
// the page may connect or load images from stays open, since analytics
// alone uses a dozen Google hosts.
func contentSecurityPolicy(nonce string) string {
	return "script-src 'nonce-" + nonce + "' 'strict-dynamic' 'wasm-unsafe-eval' 'report-sample' https: 'unsafe-inline'; " +
		"object-src 'none'; base-uri 'self'; frame-ancestors 'none'; report-uri /api/csp-report"
}

// securityHeaders adds the browser protections to every response. Values a
// handler sets itself are kept. With enforce false the policy is sent as
// Content-Security-Policy-Report-Only: violations are reported, nothing is
// blocked (CSP_ENFORCE switches it).
func securityHeaders(enforce bool) func(http.Handler) http.Handler {
	cspHeader := "Content-Security-Policy-Report-Only"
	if enforce {
		cspHeader = "Content-Security-Policy"
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			set := func(k, v string) {
				if h.Get(k) == "" {
					h.Set(k, v)
				}
			}
			nonce := cspnonce.New()
			set("X-Content-Type-Options", "nosniff")
			// Nothing embeds the app; framing it only enables clickjacking.
			set("X-Frame-Options", "DENY")
			set("Referrer-Policy", "strict-origin-when-cross-origin")
			// Geolocation fills in the weather location; nothing else is used.
			set("Permissions-Policy", "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)")
			set(cspHeader, contentSecurityPolicy(nonce))
			// Over HTTPS only, so local development on http:// is unaffected.
			// No includeSubDomains: other subdomains are not ours to promise.
			if r.Header.Get("X-Forwarded-Proto") == "https" || r.TLS != nil {
				set("Strict-Transport-Security", "max-age=31536000")
			}
			next.ServeHTTP(w, r.WithContext(cspnonce.With(r.Context(), nonce)))
		})
	}
}
