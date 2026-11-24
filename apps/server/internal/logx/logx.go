// Package logx configures structured logging.
//
// Logs go to stdout as JSON. When LOGTAIL_SOURCE_TOKEN is set they are also
// shipped to Better Stack, as the pino logtail transport did.
package logx

import (
	"log/slog"
	"os"

	"github.com/denysovkos/migraine.club/internal/config"
)

// New returns the process logger.
func New(cfg *config.Config) *slog.Logger {
	var h slog.Handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	if cfg.LogtailSourceToken != "" {
		h = newBetterStack(h, cfg.LogtailSourceToken)
	}
	return slog.New(h)
}
