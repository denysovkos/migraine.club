// Package server wires the HTTP routes.
package server

import (
	"net/http"

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
	// Outermost, so it also sees the 500 of a recovered panic.
	r.Use(requestLog(d.Log))
	r.Use(middleware.Recoverer)
	r.Use(reportPanics)
	r.Use(knownMethods)
	r.Use(nextNormalize)
	r.Use(routeVary(r))
	r.Use(compress)
	r.Use(middleware.GetHead)
	r.Use(forwardedHeaders(d.Cfg.Port))
	r.Use(securityHeaders)

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
	r.Method(http.MethodPost, "/api/csp-report", newCSPReports(d.Log, d.Clock))

	fallback := opts.Fallback
	if fallback == nil {
		fallback = http.NotFoundHandler()
	}
	r.Handle("/monitoring", sentryTunnel(fallback))
	r.Handle("/umami/script.js", umamiScript())

	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) { routeMethods(r, w, req) })
	if opts.Fallback != nil {
		r.NotFound(opts.Fallback.ServeHTTP)
	}
	return r
}
