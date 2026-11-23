package server

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
)

// What the Next server did before any route: its URL normalisation, the
// redirects and rewrites of next.config.mjs and @sentry/nextjs's tunnel.

// nextRedirect answers like Next's redirects: 308, Location and Refresh
// headers, and the target as the body.
func nextRedirect(w http.ResponseWriter, r *http.Request, location string) {
	w.Header().Set("Location", location)
	w.Header().Set("Refresh", "0;url="+location)
	w.WriteHeader(http.StatusPermanentRedirect)
	if r.Method != http.MethodHead {
		_, _ = w.Write([]byte(location))
	}
}

var repeatedSlashes = regexp.MustCompile(`//+`)

// aiConnector is the redirects() of next.config.mjs: the MCP guide moved.
var aiConnector = regexp.MustCompile(`^(/[^/]+)?/help/ai-connector$`)

// splitURI splits the raw request target into path and query (with "?").
func splitURI(r *http.Request) (string, string) {
	uri := r.RequestURI
	if uri == "" {
		uri = r.URL.RequestURI()
	}
	if p, q, ok := strings.Cut(uri, "?"); ok {
		return p, "?" + q
	}
	return uri, ""
}

// nextNormalize redirects as Next did: backslashes and repeated slashes
// collapsed (normalizeRepeatedSlashes), then a trailing slash dropped
// (trailingSlash: false), then the configured redirects.
func nextNormalize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, query := splitURI(r)
		if strings.Contains(path, `\`) || strings.Contains(path, "//") {
			nextRedirect(w, r, repeatedSlashes.ReplaceAllString(strings.ReplaceAll(path, `\`, "/"), "/")+query)
			return
		}
		if len(path) > 1 && strings.HasSuffix(path, "/") {
			nextRedirect(w, r, strings.TrimSuffix(path, "/")+query)
			return
		}
		if m := aiConnector.FindStringSubmatch(path); m != nil {
			nextRedirect(w, r, m[1]+"/mcp"+query)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// externalRewrite proxies to an external URL the way a Next rewrite did:
// the request's own query is kept next to the destination's.
func externalRewrite(target func(r *http.Request) *url.URL) http.Handler {
	return &httputil.ReverseProxy{Rewrite: func(pr *httputil.ProxyRequest) {
		u := target(pr.In)
		q := u.Query()
		for k, vs := range pr.In.URL.Query() {
			if !q.Has(k) {
				q[k] = vs
			}
		}
		pr.Out.URL = &url.URL{Scheme: u.Scheme, Host: u.Host, Path: u.Path, RawQuery: q.Encode()}
		pr.Out.Host = u.Host
		pr.SetXForwarded()
	}, ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
		// Next answered a failed external rewrite with its plain 500.
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("Internal Server Error"))
	}}
}

var (
	digits = regexp.MustCompile(`^\d*$`)
	region = regexp.MustCompile(`^[a-z]{2}$`)
)

// sentryTunnel is @sentry/nextjs's tunnelRoute: /monitoring?o=<org>&p=<project>[&r=<region>]
// forwards the browser SDK's envelopes to Sentry's ingest. Without those
// parameters the path has no handler.
func sentryTunnel(notFound http.Handler) http.Handler {
	proxy := externalRewrite(func(r *http.Request) *url.URL {
		q := r.URL.Query()
		rg := q.Get("r")
		if !region.MatchString(rg) {
			rg = ""
		}
		return sentryIngest(q.Get("o"), rg, q.Get("p"))
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if !q.Has("o") || !q.Has("p") || !digits.MatchString(q.Get("o")) || !digits.MatchString(q.Get("p")) {
			notFound.ServeHTTP(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

// sentryIngest is the tunnel's destination for an org, region and project.
var sentryIngest = func(org, region, project string) *url.URL {
	host := "o" + org + ".ingest.sentry.io"
	if region != "" {
		host = "o" + org + ".ingest." + region + ".sentry.io"
	}
	return &url.URL{Scheme: "https", Host: host, Path: "/api/" + project + "/envelope/", RawQuery: "hsts=0"}
}

// umamiURL is where /umami/script.js comes from.
var umamiURL = func() *url.URL { return &url.URL{Scheme: "https", Host: "cloud.umami.is", Path: "/script.js"} }

// umamiScript is the /umami/script.js rewrite to Umami's hosted script.
func umamiScript() http.Handler {
	return externalRewrite(func(*http.Request) *url.URL { return umamiURL() })
}
