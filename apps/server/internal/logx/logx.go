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
	if hub != nil {
		h = newSentryHandler(h, hub)
	}
	return slog.New(h)
}
