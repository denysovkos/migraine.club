// Package mcpapi mounts /api/mcp.
package mcpapi

import (
	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/api/episodes"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/mcp"
	"github.com/denysovkos/migraine.club/internal/service/appointmentprep"
	"github.com/denysovkos/migraine.club/internal/service/diary"
	"github.com/denysovkos/migraine.club/internal/service/factors"
	"github.com/denysovkos/migraine.club/internal/service/insights"
	"github.com/denysovkos/migraine.club/internal/service/meds"
	"github.com/denysovkos/migraine.club/internal/service/reports"
)

// Services builds the services the tools call.
func Services(d *app.Deps) mcp.Services {
	return mcp.Services{
		Episodes:        episodes.NewService(d),
		Diary:           &diary.Service{Q: d.Q, Now: d.Clock},
		Meds:            &meds.Service{Q: d.Q, Log: d.Log, Now: d.Clock},
		Factors:         &factors.Service{Pool: d.Pool, Q: d.Q, Now: d.Clock},
		Insights:        &insights.Service{Q: d.Q, Log: d.Log, Now: d.Clock},
		Reports:         &reports.Service{Q: d.Q, Now: d.Clock},
		AppointmentPrep: &appointmentprep.Service{Q: d.Q, Now: d.Clock},
		InsightsEnabled: d.Cfg.EnableInsights,
	}
}

// Mount registers /api/mcp and its OAuth metadata routes; /api/mcp for the methods the Next route exported (GET and
// POST; HEAD runs GET). Next answered every other method itself.
func Mount(r chi.Router, d *app.Deps) {
	srv, err := mcp.NewServer(Services(d), d.Q, d.Log, d.Clock)
	if err != nil {
		panic(err)
	}
	verify := mcp.ClerkVerifier(d.Clerk)
	if d.Cfg.E2EMockAuth {
		verify = mcp.E2EVerifier
	}
	h := mcp.NewHandler(srv, verify, d.Log)
	r.Get("/api/mcp", h.ServeHTTP)
	r.Head("/api/mcp", h.ServeHTTP)
	r.Post("/api/mcp", h.ServeHTTP)

	pr := mcp.ProtectedResource(d.Cfg.ClerkPublishableKey, d.Cfg.AppURL)
	r.Get("/.well-known/oauth-protected-resource/mcp", pr)
	r.Head("/.well-known/oauth-protected-resource/mcp", pr)
	r.Options("/.well-known/oauth-protected-resource/mcp", mcp.MetadataOptions)
	as := mcp.AuthorizationServer(d.Cfg.ClerkPublishableKey, d.HTTP)
	r.Get("/.well-known/oauth-authorization-server", as)
	r.Head("/.well-known/oauth-authorization-server", as)
	r.Options("/.well-known/oauth-authorization-server", mcp.MetadataOptions)
}
