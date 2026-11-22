// Package server wires the HTTP routes.
package server

import (
	"net/http"
	"net/http/httputil"
	"net/url"

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
	p := httputil.NewSingleHostReverseProxy(u)
	orig := p.Director
	p.Director = func(r *http.Request) {
		host := r.Host
		orig(r)
		r.Host = host
	}
	return p, nil
}
