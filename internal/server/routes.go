package server

import (
	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
)

// mountAPI registers every ported API route.
func mountAPI(r chi.Router, d *app.Deps) {
	_ = r
	_ = d
}
