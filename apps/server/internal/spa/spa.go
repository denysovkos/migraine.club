// Package spa serves the Vite build of web/: static files with the headers
// Next sent for public/, the page shell with each route's prerendered head
// (apps/client/scripts/prerender.mts), next-intl's locale routing and the 404s.
package spa

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"

	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
)

// Route is one page pattern of routes.json.
type Route struct {
	Pattern   string `json:"pattern"`
	Localized bool   `json:"localized"`
	// Redirect is where a redirect-only page sent every visitor (a 307).
	Redirect string `json:"redirect"`
	// SignedInRedirect is where a signed-in visitor went instead.
	SignedInRedirect string `json:"signedInRedirect"`
	// RequiresUser marks pages whose layout or page called
	// requireUserOrRedirect: signed-out visitors went to the sign-in page.
	RequiresUser bool `json:"requiresUser"`
}

// Config is what the shell passes to the client (window.__APP_CONFIG__).
type Config struct {
	EnableInsights bool `json:"enableInsights"`
}

// Handler serves the SPA.
type Handler struct {
	// The build's files, read once: the build does not change while the
	// server runs. gzipped holds the compressible ones, compressed once.
	files   map[string][]byte
	gzipped map[string][]byte
	shell   string
	heads   map[string]map[string]string
	routes  []Route
	config  string
}

// nextVary is the Vary header Next put on what it rendered.
const nextVary = "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch"

// notFoundHead is the head Next sent with its built-in 404 page.
const notFoundHead = `<meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/><title>404: This page could not be found.</title>`

// New reads the build output.
func New(dist fs.FS, cfg Config) (*Handler, error) {
	shell, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		return nil, err
	}
	h := &Handler{shell: string(shell)}
	if h.files, h.gzipped, err = loadFiles(dist); err != nil {
		return nil, err
	}
	for name, dst := range map[string]any{"heads.json": &h.heads, "routes.json": &h.routes} {
		b, err := fs.ReadFile(dist, name)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(b, dst); err != nil {
			return nil, err
		}
	}
	b, _ := json.Marshal(cfg)
	// A JSON object inside <script>: "<" cannot close the element.
	h.config = strings.ReplaceAll(string(b), "<", `<`)
	return h, nil
}

var contentTypes = map[string]string{
	".js":          "application/javascript; charset=UTF-8",
	".mjs":         "application/javascript; charset=UTF-8",
	".css":         "text/css; charset=UTF-8",
	".json":        "application/json; charset=UTF-8",
	".webmanifest": "application/manifest+json",
	".ico":         "image/x-icon",
	".png":         "image/png",
	".svg":         "image/svg+xml",
	".jpg":         "image/jpeg",
	".webp":        "image/webp",
	".woff2":       "font/woff2",
	".xml":         "application/xml",
	".txt":         "text/plain; charset=UTF-8",
	".html":        "text/html; charset=UTF-8",
}

func (h *Handler) file(name string) ([]byte, bool) {
	b, ok := h.files[name]
	return b, ok
}

// GzipLevel is the compression level of the server's gzip responses.
const GzipLevel = 5

// loadFiles reads every file the handler serves as is, and gzips those the
// compression middleware would gzip on every request.
func loadFiles(dist fs.FS) (files, gzipped map[string][]byte, err error) {
	files, gzipped = map[string][]byte{}, map[string][]byte{}
	err = fs.WalkDir(dist, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if name == "index.html" || name == "heads.json" || name == "routes.json" {
			return nil
		}
		b, err := fs.ReadFile(dist, name)
		if err != nil {
			return err
		}
		files[name] = b
		if httpx.Compressible(contentType(name)) {
			var buf bytes.Buffer
			zw, err := gzip.NewWriterLevel(&buf, GzipLevel)
			if err != nil {
				return err
			}
			if _, err := zw.Write(b); err != nil {
				return err
			}
			if err := zw.Close(); err != nil {
				return err
			}
			gzipped[name] = buf.Bytes()
		}
		return nil
	})
	return files, gzipped, err
}

func contentType(name string) string {
	if ct := contentTypes[path.Ext(name)]; ct != "" {
		return ct
	}
	return "application/octet-stream"
}

// acceptsGzip is the compression middleware's choice of gzip: any listed
// encoding containing "gzip" (it prefers gzip to deflate).
func acceptsGzip(r *http.Request) bool {
	for _, v := range strings.Split(strings.ToLower(r.Header.Get("Accept-Encoding")), ",") {
		if strings.Contains(v, "gzip") {
			return true
		}
	}
	return false
}

// static serves a build file: hashed bundles for a year, public/ files as
// Next did (public, max-age=0), robots.txt and sitemap.xml as metadata routes.
func (h *Handler) static(w http.ResponseWriter, r *http.Request, name string, body []byte) {
	ct := contentType(name)
	switch {
	case strings.HasPrefix(name, "assets/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case name == "robots.txt" || name == "sitemap.xml":
		w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
	default:
		w.Header().Set("Cache-Control", "public, max-age=0")
	}
	w.Header().Set("Content-Type", ct)
	if gz, ok := h.gzipped[name]; ok && r.Method == http.MethodGet && acceptsGzip(r) {
		// What the compression middleware would send, without compressing
		// the same bytes on every request; it leaves encoded bodies alone.
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(gz)
		return
	}
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(body)
}

func segments(p string) []string {
	var out []string
	for _, s := range strings.Split(p, "/") {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// matchScore scores a pattern against path segments: static segments beat
// dynamic ones; an optional catch-all takes the rest.
func matchScore(pattern string, parts []string) (int, bool) {
	segs := segments(pattern)
	score := 0
	for i, seg := range segs {
		switch {
		case seg == "*?":
			return score, true
		case seg == "*":
			return score, len(parts) > i
		case i >= len(parts):
			return 0, false
		case strings.HasPrefix(seg, ":"):
			score++
		case seg == parts[i]:
			score += 2
		default:
			return 0, false
		}
	}
	return score, len(segs) == len(parts)
}

// match finds the page pattern for a pathname.
func (h *Handler) match(pathname string, localized bool) (Route, bool) {
	parts := segments(pathname)
	var best Route
	bestScore := -1
	for _, rt := range h.routes {
		if rt.Localized != localized {
			continue
		}
		if score, ok := matchScore(rt.Pattern, parts); ok && score > bestScore {
			best, bestScore = rt, score
		}
	}
	return best, bestScore >= 0
}

// serveRoute answers a matched page: its redirect, or the shell with the
// head for the locale.
func (h *Handler) serveRoute(w http.ResponseWriter, r *http.Request, rt Route, locale string) {
	switch r.Method {
	case http.MethodOptions:
		w.Header().Set("Vary", nextVary)
		w.WriteHeader(http.StatusBadRequest)
		return
	case http.MethodTrace:
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	target := rt.Redirect
	if target == "" && rt.SignedInRedirect != "" && auth.UserID(r.Context()) != "" {
		target = rt.SignedInRedirect
	}
	if target == "" && rt.RequiresUser && auth.SignedOut(r.Context()) {
		target = signInPath(locale)
	}
	if target != "" {
		// Thrown by the page or a layout while rendering.
		w.Header().Set("Vary", nextVary)
		w.Header().Set("Location", target)
		w.WriteHeader(http.StatusTemporaryRedirect)
		return
	}
	h.page(w, http.StatusOK, h.heads[rt.Pattern][locale])
}

// signInPath is getSignInPath (src/libs/AuthGuard.ts).
func signInPath(locale string) string {
	if locale == DefaultLocale {
		return "/sign-in"
	}
	return "/" + locale + "/sign-in"
}

func (h *Handler) page(w http.ResponseWriter, status int, head string) {
	w.Header().Set("Vary", nextVary)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate")
	w.WriteHeader(status)
	html := strings.Replace(h.shell, "<!--app-head-->", head+`<script>window.__APP_CONFIG__=`+h.config+`</script>`, 1)
	_, _ = w.Write([]byte(html))
}

func (h *Handler) notFound(w http.ResponseWriter) { h.page(w, http.StatusNotFound, notFoundHead) }

// skipsMiddleware is where next-intl never ran: the Next proxy matcher's
// exclusions (files with an extension, Next internals, monitoring, share
// pages, discovery documents, the PWA files) and the API paths the proxy
// only authenticated.
var skipsMiddleware = regexp.MustCompile(`^/(?:.+\.\w+$|_next|monitoring|share|\.well-known|sw\.js|manifest\.webmanifest|api|trpc)`)

// requestOrigin is the URL origin next-intl built its links from.
func requestOrigin(r *http.Request) string {
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		proto = "http"
	}
	return proto + "://" + host
}

// ServeHTTP serves files, then pages.
//
// Methods as Next answered them: files only GET and HEAD (405 with Allow
// otherwise), pages render for any method but OPTIONS (400) and TRACE
// (Next failed with a 500 there; 405 here).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if body, ok := h.file(name); ok {
		if name == "robots.txt" || name == "sitemap.xml" {
			// Metadata routes: rendered by Next, for any method.
			w.Header().Set("Vary", nextVary)
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header()["Allow"] = []string{http.MethodGet, http.MethodHead}
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		h.static(w, r, name, body)
		return
	}
	p := r.URL.Path
	if skipsMiddleware.MatchString(p) || strings.HasPrefix(p, "/admin") {
		rt, ok := h.match(p, false)
		if !ok {
			h.notFound(w)
			return
		}
		h.serveRoute(w, r, rt, DefaultLocale)
		return
	}
	res, ok := nextIntl(r, requestOrigin(r))
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if res.cookie != nil {
		http.SetCookie(w, res.cookie)
	}
	if res.redirect != "" {
		w.Header().Set("Location", res.redirect)
		w.WriteHeader(http.StatusTemporaryRedirect)
		return
	}
	w.Header().Set("Link", res.links)
	rt, ok := h.match(res.internal, true)
	if !ok {
		h.notFound(w)
		return
	}
	h.serveRoute(w, r, rt, res.locale)
}
