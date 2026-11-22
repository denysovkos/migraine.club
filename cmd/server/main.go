// Command server runs migraine.club: the API, the MCP endpoint, the cron
// endpoints and the web app, in one process.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "time/tzdata" // users' IANA zones must resolve in a minimal image

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/config"
	"github.com/denysovkos/migraine.club/internal/db"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/logx"
	"github.com/denysovkos/migraine.club/internal/server"
	"github.com/denysovkos/migraine.club/migrations"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logx.New(cfg)
	slog.SetDefault(log)

	if cfg.DatabaseURL == "" {
		return config.ErrNoDatabase
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, db.Options{URL: cfg.DatabaseURL, MaxConn: cfg.DatabasePoolMax})
	if err != nil {
		return err
	}
	defer pool.Close()

	if cfg.RunMigrationsBoot {
		n, err := db.Migrate(ctx, pool, migrations.FS)
		if err != nil {
			return err
		}
		log.Info("Database migrations applied", "applied", n)
	} else {
		log.Info("RUN_MIGRATIONS_ON_BOOT=false; skipping startup migrations")
	}

	clerk := auth.NewClerk(cfg.ClerkSecretKey, cfg.ClerkPublishableKey)
	var users auth.Users = clerk
	if cfg.E2EMockAuth {
		users = auth.MockUsers{}
	}
	deps := &app.Deps{
		Cfg:   cfg,
		Pool:  pool,
		Q:     q.New(pool),
		Users: users,
		Clerk: clerk,
		Log:   log,
		HTTP:  &http.Client{Timeout: 30 * time.Second},
		Now:   time.Now,
	}

	opts := server.Options{}
	if upstream := os.Getenv("LEGACY_NEXT_UPSTREAM"); upstream != "" {
		if opts.Fallback, err = server.ProxyTo(upstream); err != nil {
			return err
		}
	}

	srv := &http.Server{
		Addr:              net.JoinHostPort("", cfg.Port),
		Handler:           server.New(deps, opts),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}

	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", srv.Addr)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 25*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
