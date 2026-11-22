// Package db owns the Postgres connection pool, migrations and the generated
// query layer.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// QueryTimeout caps how long one statement may block a request. The Node
// server used the same 30s client-side timer; Neon's pooler rejects
// statement_timeout as a startup parameter, so it cannot be set server-side.
const QueryTimeout = 30 * time.Second

// Options configures NewPool.
type Options struct {
	URL     string
	MaxConn int32
}

// NewPool opens the pool with the settings the Node server used: 15
// connections by default (cron jobs and web requests share it), 30s idle
// timeout and a 10s connect timeout.
func NewPool(ctx context.Context, o Options) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(o.URL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = 15
	if o.MaxConn > 0 {
		cfg.MaxConns = o.MaxConn
	}
	cfg.MaxConnIdleTime = 30 * time.Second
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	// Neon's pooler is PgBouncer in transaction mode, so a named prepared
	// statement may not exist on the next transaction's server connection.
	// Cached descriptions with unnamed statements work through it.
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheDescribe
	return pgxpool.NewWithConfig(ctx, cfg)
}
