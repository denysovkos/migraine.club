package db

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MigrationLockKey is the advisory lock that serialises instances booting at
// the same time (a rolling deploy): one applies migrations, the others wait and
// then find nothing to do. The value is the one the Node server used, so an old
// and a new instance never migrate concurrently either.
const MigrationLockKey int64 = 4_827_301_955

const statementBreakpoint = "--> statement-breakpoint"

// Migration is one entry of meta/_journal.json with its SQL.
type Migration struct {
	Tag          string
	FolderMillis int64
	Hash         string
	Statements   []string
}

type journal struct {
	Entries []struct {
		Tag  string `json:"tag"`
		When int64  `json:"when"`
	} `json:"entries"`
}

// ReadMigrations loads the journal and its files the way drizzle-orm's
// readMigrationFiles does: the hash is the SHA-256 of the whole file and the
// statements are split on the breakpoint marker.
func ReadMigrations(fsys fs.FS) ([]Migration, error) {
	raw, err := fs.ReadFile(fsys, "meta/_journal.json")
	if err != nil {
		return nil, fmt.Errorf("read journal: %w", err)
	}
	var j journal
	if err := json.Unmarshal(raw, &j); err != nil {
		return nil, fmt.Errorf("parse journal: %w", err)
	}
	out := make([]Migration, 0, len(j.Entries))
	for _, e := range j.Entries {
		body, err := fs.ReadFile(fsys, e.Tag+".sql")
		if err != nil {
			return nil, fmt.Errorf("no file %s.sql found in migrations folder", e.Tag)
		}
		sum := sha256.Sum256(body)
		out = append(out, Migration{
			Tag:          e.Tag,
			FolderMillis: e.When,
			Hash:         hex.EncodeToString(sum[:]),
			Statements:   strings.Split(string(body), statementBreakpoint),
		})
	}
	return out, nil
}

// Migrate applies pending migrations. It keeps using drizzle's bookkeeping
// table (drizzle.__drizzle_migrations) with the same rule drizzle used: every
// journal entry newer than the most recently applied one runs, all inside one
// transaction. Production databases migrated by the Node server therefore need
// no conversion step.
func Migrate(ctx context.Context, pool *pgxpool.Pool, fsys fs.FS) (applied int, err error) {
	migrations, err := ReadMigrations(fsys)
	if err != nil {
		return 0, err
	}

	conn, err := pool.Acquire(ctx)
	if err != nil {
		return 0, err
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", MigrationLockKey); err != nil {
		return 0, fmt.Errorf("take migration lock: %w", err)
	}
	defer func() {
		// Use a fresh context: the request context may already be cancelled.
		_, _ = conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", MigrationLockKey)
	}()

	if _, err := conn.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS "drizzle"`); err != nil {
		return 0, err
	}
	if _, err := conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)`); err != nil {
		return 0, err
	}

	var last *int64
	row := conn.QueryRow(ctx, `SELECT created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`)
	var createdAt int64
	switch err := row.Scan(&createdAt); err {
	case nil:
		last = &createdAt
	case pgx.ErrNoRows:
	default:
		return 0, err
	}

	err = pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		for _, m := range migrations {
			if last != nil && *last >= m.FolderMillis {
				continue
			}
			for _, stmt := range m.Statements {
				if strings.TrimSpace(stmt) == "" {
					continue
				}
				if _, err := tx.Exec(ctx, stmt); err != nil {
					return fmt.Errorf("migration %s: %w", m.Tag, err)
				}
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
				m.Hash, m.FolderMillis); err != nil {
				return err
			}
			applied++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return applied, nil
}
