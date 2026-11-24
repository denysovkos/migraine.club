// Command server runs migraine.club: the API, the MCP endpoint, the cron
// endpoints and the web app, in one process.
//
// `server migrate` only applies pending database migrations and exits; the
// deploy runs it before the new version starts (render.yaml).
package main

import (
	"context"
	"errors"
	"fmt"
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
	"github.com/denysovkos/migraine.club/internal/spa"
	"github.com/denysovkos/migraine.club/migrations"
)

func main() {
	var err error
	switch {
	case len(os.Args) < 2:
		err = run()
	case os.Args[1] == "migrate":
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()
		var n int
		if n, err = migrate(ctx, os.Getenv("DATABASE_URL")); err == nil {
			slog.Info("Database migrations applied", "applied", n)
		}
	default:
		err = fmt.Errorf("unknown command %q (the only command is migrate)", os.Args[1])
	}
	if err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

// migrate applies pending migrations to the database at url. It needs only
// DATABASE_URL, not the rest of the server's configuration.
func migrate(ctx context.Context, url string) (int, error) {
	if url == "" {
		return 0, config.ErrNoDatabase
	}
	pool, err := db.NewPool(ctx, db.Options{URL: url, MaxConn: 1})
	if err != nil {
		return 0, err
	}
	defer pool.Close()
	return db.Migrate(ctx, pool, migrations.FS)
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	environment := "development"
	if os.Getenv("RENDER") != "" {
		environment = "production"
	}
	hub, flushSentry := logx.InitSentry(cfg.ServerSentryDSN, environment, os.Getenv("RENDER_GIT_COMMIT"))
	defer flushSentry()
	log := logx.New(cfg, hub)
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
	if dist := os.Getenv("SPA_DIST"); dist != "" {
		// The client build (apps/client/dist) serves every page.
		if opts.Fallback, err = spa.New(os.DirFS(dist), spa.Config{EnableInsights: cfg.EnableInsights}); err != nil {
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
