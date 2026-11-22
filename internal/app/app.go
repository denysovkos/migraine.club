// Package app holds the dependencies every domain package receives.
package app

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/config"
	"github.com/denysovkos/migraine.club/internal/db/q"
)

// Deps are shared by the HTTP handlers, jobs and the MCP server.
type Deps struct {
	Cfg   *config.Config
	Pool  *pgxpool.Pool
	Q     *q.Queries
	Users auth.Users
	Clerk *auth.Clerk
	Log   *slog.Logger
	// HTTP is used for outbound calls (weather, space weather, push).
	HTTP *http.Client
	// Now is the clock; tests replace it.
	Now func() time.Time
}

// Clock returns d.Now() or time.Now().
func (d *Deps) Clock() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}
