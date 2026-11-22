package server

import (
	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/api/episodes"
	"github.com/denysovkos/migraine.club/internal/api/user"
	"github.com/denysovkos/migraine.club/internal/api/weather"
	"github.com/denysovkos/migraine.club/internal/app"
)

// mountAPI registers every ported API route.
func mountAPI(r chi.Router, d *app.Deps) {
	user.Mount(r, d)
	weather.Mount(r, d)
	episodes.Mount(r, d)
}
