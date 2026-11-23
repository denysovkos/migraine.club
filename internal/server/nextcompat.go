package server

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// What the Next server did before any route: its URL normalisation, the
// redirects and rewrites of next.config.mjs and @sentry/nextjs's tunnel.

// nextRedirect answers like Next's redirects: 308, Location and Refresh
// headers, and the target as the body.
func nextRedirect(w http.ResponseWriter, r *http.Request, location string) {
	w.Header()["Content-Type"] = nil // no sniffed type: Next sent none
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

// nodeMethods is Node's http.METHODS: its parser answered any other method
// with a bare 400 before Next saw the request.
var nodeMethods = map[string]bool{}

func init() {
	for _, m := range strings.Fields(`ACL BIND CHECKOUT CONNECT COPY DELETE GET HEAD LINK LOCK M-SEARCH MERGE
		MKACTIVITY MKCALENDAR MKCOL MOVE NOTIFY OPTIONS PATCH POST PROPFIND PROPPATCH PURGE PUT QUERY
		REBIND REPORT SEARCH SOURCE SUBSCRIBE TRACE UNBIND UNLINK UNLOCK UNSUBSCRIBE`) {
		nodeMethods[m] = true
	}
}

func knownMethods(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !nodeMethods[r.Method] {
			w.Header().Set("Connection", "close")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// NextVary is the Vary header Next put on everything it rendered: route
// handlers, pages, 404s and metadata routes, not on middleware redirects or
// public files. (Compression adds Accept-Encoding.)
const NextVary = "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch"

// routeVary sets NextVary on requests a route handler answers, including
// with a method it lacks; the SPA handler sets it on what it renders.
func routeVary(router chi.Routes) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isRouteHandler(router, r) {
				w.Header().Set("Vary", NextVary)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// isRouteHandler reports whether a Next route handler owns the path: any
// method matches it. The rewrites (tunnel, Umami) were not route handlers.
func isRouteHandler(router chi.Routes, r *http.Request) bool {
	if r.URL.Path == "/monitoring" || r.URL.Path == "/umami/script.js" || r.URL.Path == "/healthz" {
		return false
	}
	for _, m := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if router.Match(chi.NewRouteContext(), m, r.URL.Path) {
			return true
		}
	}
	return false
}

// compress is Next's compression middleware: gzip for compressible types.
// It added Vary: Accept-Encoding whenever the type qualified, HEAD
// included, but had nothing to compress for HEAD.
func compress(next http.Handler) http.Handler {
	gz := middleware.Compress(5, compressible...)(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			next.ServeHTTP(&headVary{ResponseWriter: w}, r)
			return
		}
		gz.ServeHTTP(w, r)
	})
}

type headVary struct {
	http.ResponseWriter
	done bool
}

func (h *headVary) WriteHeader(code int) {
	if !h.done {
		h.done = true
		ct, _, _ := strings.Cut(h.Header().Get("Content-Type"), ";")
		for _, c := range compressible {
			if strings.EqualFold(strings.TrimSpace(ct), c) {
				h.Header().Add("Vary", "Accept-Encoding")
				break
			}
		}
	}
	h.ResponseWriter.WriteHeader(code)
}

func (h *headVary) Write(b []byte) (int, error) {
	if !h.done {
		h.WriteHeader(http.StatusOK)
	}
	return h.ResponseWriter.Write(b)
}

// compressible is what Next's compression middleware gzipped among the
// types this server sends. Event streams set no-transform, which it
// respected, so they stay uncompressed.
var compressible = []string{
	"text/html", "text/css", "text/plain", "text/javascript", "text/xml",
	"application/javascript", "application/json", "application/xml",
	"application/manifest+json", "image/svg+xml", "image/x-icon",
}

// routeMethods answers a route handler path with a method it does not
// export, as Next's app route module did: OPTIONS lists the methods (204),
// anything else is a bare 405. (HEAD runs GET: middleware.GetHead.)
func routeMethods(router chi.Routes, w http.ResponseWriter, r *http.Request) {
	has := func(m string) bool { return router.Match(chi.NewRouteContext(), m, r.URL.Path) }
	if r.Method == http.MethodOptions {
		allow := []string{http.MethodOptions}
		for _, m := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			if has(m) {
				allow = append(allow, m)
				if m == http.MethodGet {
					allow = append(allow, http.MethodHead)
				}
			}
		}
		sort.Strings(allow)
		w.Header().Set("Allow", strings.Join(allow, ", "))
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.WriteHeader(http.StatusMethodNotAllowed)
}
