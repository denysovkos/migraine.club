// Package logx configures structured logging.
//
// Logs go to stdout as JSON. When LOGTAIL_SOURCE_TOKEN is set they are also
// shipped to Better Stack, as the pino logtail transport did.
package logx

import (
	"log/slog"
	"os"

	"github.com/getsentry/sentry-go"

	"github.com/denysovkos/migraine.club/internal/config"
)

// New returns the process logger. With a Sentry hub, ERROR records are
// also reported there (see sentryHandler for what is sent).
func New(cfg *config.Config, hub *sentry.Hub) *slog.Logger {
	var h slog.Handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	if cfg.LogtailSourceToken != "" {
		h = newBetterStack(h, cfg.LogtailSourceToken)
	}
	return slog.New(chain(h, hub))
}

// chain adds to h the handlers every record passes through: canceled
// requests lowered to INFO first, then Sentry for what is still an error.
func chain(h slog.Handler, hub *sentry.Hub) slog.Handler {
	if hub != nil {
		h = newSentryHandler(h, hub)
	}
	return newCanceledHandler(h)
}
