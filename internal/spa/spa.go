// Package spa serves the Vite build of web/: static files with the headers
// Next sent for public/, the page shell with each route's prerendered head
// (web/scripts/prerender.mts), next-intl's locale routing and the 404s.
package spa

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"

	"github.com/denysovkos/migraine.club/internal/auth"
)

// Route is one page pattern of routes.json.
type Route struct {
	Pattern   string `json:"pattern"`
	Localized bool   `json:"localized"`
	// Redirect is where a redirect-only page sent every visitor (a 307).
	Redirect string `json:"redirect"`
	// SignedInRedirect is where a signed-in visitor went instead.
	SignedInRedirect string `json:"signedInRedirect"`
}

// Config is what the shell passes to the client (window.__APP_CONFIG__).
type Config struct {
	EnableInsights bool `json:"enableInsights"`
}

// Handler serves the SPA.
type Handler struct {
	dist   fs.FS
	shell  string
	heads  map[string]map[string]string
	routes []Route
	config string
}

// notFoundHead is the head Next sent with its built-in 404 page.
const notFoundHead = `<meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/><title>404: This page could not be found.</title>`

// New reads the build output.
func New(dist fs.FS, cfg Config) (*Handler, error) {
	shell, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		return nil, err
	}
	h := &Handler{dist: dist, shell: string(shell)}
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
	if name == "" || name == "index.html" || name == "heads.json" || name == "routes.json" {
		return nil, false
	}
	b, err := fs.ReadFile(h.dist, name)
	return b, err == nil
}

// static serves a build file: hashed bundles for a year, public/ files as
// Next did (public, max-age=0), robots.txt and sitemap.xml as metadata routes.
func (h *Handler) static(w http.ResponseWriter, r *http.Request, name string, body []byte) {
	ct := contentTypes[path.Ext(name)]
	if ct == "" {
		ct = "application/octet-stream"
	}
	switch {
	case strings.HasPrefix(name, "assets/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case name == "robots.txt" || name == "sitemap.xml":
		w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
	default:
		w.Header().Set("Cache-Control", "public, max-age=0")
	}
	w.Header().Set("Content-Type", ct)
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
	target := rt.Redirect
	if target == "" && rt.SignedInRedirect != "" && auth.UserID(r.Context()) != "" {
		target = rt.SignedInRedirect
	}
	if target != "" {
		w.Header().Set("Location", target)
		w.WriteHeader(http.StatusTemporaryRedirect)
		return
	}
	h.page(w, http.StatusOK, h.heads[rt.Pattern][locale])
}

func (h *Handler) page(w http.ResponseWriter, status int, head string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate")
	w.WriteHeader(status)
	html := strings.Replace(h.shell, "<!--app-head-->", head+`<script>window.__APP_CONFIG__=`+h.config+`</script>`, 1)
	_, _ = w.Write([]byte(html))
}

func (h *Handler) notFound(w http.ResponseWriter) { h.page(w, http.StatusNotFound, notFoundHead) }

// skipsMiddleware is the Next proxy matcher's exclusions: files with an
// extension, Next internals, monitoring, share pages, discovery documents
// and the PWA files.
var skipsMiddleware = regexp.MustCompile(`^/(?:.+\.\w+$|_next|monitoring|share|\.well-known|sw\.js|manifest\.webmanifest)`)

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
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if body, ok := h.file(name); ok {
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
