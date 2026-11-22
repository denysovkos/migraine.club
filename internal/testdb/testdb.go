// Package testdb gives tests their own migrated Postgres database.
//
// The first call in a test binary migrates a template database once; every
// test then gets a cheap clone of it, so tests never see each other's rows and
// can run in parallel. Point TEST_DATABASE_URL (or DATABASE_URL) at a server
// whose user may create databases. Tests are skipped when neither is set,
// except in CI, where a missing database is a failure.
package testdb

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/denysovkos/migraine.club/internal/db"
	"github.com/denysovkos/migraine.club/migrations"
)

var (
	templateOnce sync.Once
	templateName string
	templateErr  error
)

func baseURL(t testing.TB) string {
	u := os.Getenv("TEST_DATABASE_URL")
	if u == "" {
		u = os.Getenv("DATABASE_URL")
	}
	if u == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("TEST_DATABASE_URL is required in CI")
		}
		t.Skip("set TEST_DATABASE_URL to run database tests")
	}
	return u
}

func withDatabase(raw, name string) string {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	u.Path = "/" + name
	return u.String()
}

func adminExec(ctx context.Context, raw, sql string) error {
	conn, err := pgx.Connect(ctx, withDatabase(raw, "postgres"))
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	_, err = conn.Exec(ctx, sql)
	return err
}

// template migrates one database per test binary and returns its name.
func template(t testing.TB, raw string) string {
	templateOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		templateName = "mc_tpl_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "")
		if templateErr = adminExec(ctx, raw, fmt.Sprintf(`CREATE DATABASE %q`, templateName)); templateErr != nil {
			return
		}
		pool, err := pgxpool.New(ctx, withDatabase(raw, templateName))
		if err != nil {
			templateErr = err
			return
		}
		defer pool.Close()
		_, templateErr = db.Migrate(ctx, pool, migrations.FS)
	})
	if templateErr != nil {
		t.Fatalf("prepare template database: %v", templateErr)
	}
	return templateName
}

// New returns a pool on a fresh, fully migrated database that is dropped when
// the test ends.
func New(t testing.TB) *pgxpool.Pool {
	t.Helper()
	raw := baseURL(t)
	tpl := template(t, raw)
	ctx := context.Background()
	name := "mc_t_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:20]
	if err := adminExec(ctx, raw, fmt.Sprintf(`CREATE DATABASE %q TEMPLATE %q`, name, tpl)); err != nil {
		t.Fatalf("clone template database: %v", err)
	}
	pool, err := pgxpool.New(ctx, withDatabase(raw, name))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_ = adminExec(context.Background(), raw, fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE)`, name))
	})
	return pool
}

// Empty returns a pool on a brand-new database with no tables at all, for
// tests of the migrator itself.
func Empty(t testing.TB) *pgxpool.Pool {
	t.Helper()
	raw := baseURL(t)
	ctx := context.Background()
	name := "mc_e_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:20]
	if err := adminExec(ctx, raw, fmt.Sprintf(`CREATE DATABASE %q`, name)); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, withDatabase(raw, name))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_ = adminExec(context.Background(), raw, fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE)`, name))
	})
	return pool
}
