package user

import (
	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
)

// Mount registers /api/user/* routes.
func Mount(r chi.Router, d *app.Deps) {
	c := consentHandlers{d}
	r.Get("/api/user/consent", c.list)
	r.Post("/api/user/consent", c.create)
	r.Delete("/api/user/consent", c.withdraw)
}
