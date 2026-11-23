// Package server wires the HTTP routes.
package server

import (
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
)

// Options configure the handler.
type Options struct {
	// Fallback serves every path no route matched (the SPA, or during the
	// migration the old Next server).
	Fallback http.Handler
}

// New builds the root handler.
func New(d *app.Deps, opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(nextNormalize)
	r.Use(forwardedHeaders(d.Cfg.Port))

	var resolver auth.Resolver = d.Clerk
	if d.Cfg.E2EMockAuth {
		resolver = auth.Mock{UserID: d.Cfg.MockUserID()}
	}
	r.Use(auth.Middleware(resolver))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	mountAPI(r, d)

	fallback := opts.Fallback
	if fallback == nil {
		fallback = http.NotFoundHandler()
	}
	r.Handle("/monitoring", sentryTunnel(fallback))
	r.Handle("/umami/script.js", umamiScript())

	if opts.Fallback != nil {
		r.NotFound(opts.Fallback.ServeHTTP)
		r.MethodNotAllowed(opts.Fallback.ServeHTTP)
	}
	return r
}

// ProxyTo forwards requests to another server unchanged.
func ProxyTo(raw string) (http.Handler, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	// Rewrite with what Director mode did: keep the incoming Host and
	// append the client address to X-Forwarded-For.
	p := &httputil.ReverseProxy{Rewrite: func(pr *httputil.ProxyRequest) {
		pr.SetURL(u)
		pr.Out.Host = pr.In.Host
		if ip, _, err := net.SplitHostPort(pr.In.RemoteAddr); err == nil {
			pr.Out.Header.Set("X-Forwarded-For", strings.Join(append(pr.In.Header.Values("X-Forwarded-For"), ip), ", "))
		}
	}}
	return p, nil
}
