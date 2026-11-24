package user

import (
	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/service/profile"
)

// Mount registers /api/user/* routes.
func Mount(r chi.Router, d *app.Deps) {
	c := consentHandlers{d}
	r.Get("/api/user/consent", c.list)
	r.Post("/api/user/consent", c.create)
	r.Delete("/api/user/consent", c.withdraw)

	p := profileHandlers{d: d, svc: &profile.Service{Q: d.Q, Log: d.Log, Now: d.Clock}}
	r.Get("/api/user/profile", p.get)
	r.Put("/api/user/profile", p.put)

	a := accountHandlers{d}
	r.Get("/api/user/export", a.export)
	r.Delete("/api/user/delete-account", a.deleteAccount)
}
