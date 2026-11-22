package db_test

import (
	"context"
	"fmt"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db"
	"github.com/denysovkos/migraine.club/internal/testdb"
	"github.com/denysovkos/migraine.club/migrations"
)

func TestReadMigrationsFollowsJournal(t *testing.T) {
	ms, err := db.ReadMigrations(migrations.FS)
	require.NoError(t, err)
	require.NotEmpty(t, ms)
	require.Equal(t, "0000_init-db", ms[0].Tag)
	for _, m := range ms {
		require.Len(t, m.Hash, 64)
		require.NotEmpty(t, m.Statements)
	}
}

func TestMigrateFreshDatabaseThenNoop(t *testing.T) {
	pool := testdb.Empty(t)
	ctx := context.Background()
	ms, err := db.ReadMigrations(migrations.FS)
	require.NoError(t, err)

	applied, err := db.Migrate(ctx, pool, migrations.FS)
	require.NoError(t, err)
	require.Equal(t, len(ms), applied)

	// Bookkeeping matches what drizzle-orm writes: one row per entry with the
	// file hash and the journal timestamp.
	rows, err := pool.Query(ctx, `SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`)
	require.NoError(t, err)
	defer rows.Close()
	i := 0
	for rows.Next() {
		var hash string
		var createdAt int64
		require.NoError(t, rows.Scan(&hash, &createdAt))
		require.Equal(t, ms[i].Hash, hash)
		require.Equal(t, ms[i].FolderMillis, createdAt)
		i++
	}
	require.Equal(t, len(ms), i)

	again, err := db.Migrate(ctx, pool, migrations.FS)
	require.NoError(t, err)
	require.Zero(t, again)
}

func syntheticFS(entries ...[2]string) fstest.MapFS {
	fsys := fstest.MapFS{}
	journal := `{"entries":[`
	for i, e := range entries {
		if i > 0 {
			journal += ","
		}
		journal += fmt.Sprintf(`{"tag":%q,"when":%s}`, e[0], e[1])
		fsys[e[0]+".sql"] = &fstest.MapFile{Data: []byte(fmt.Sprintf(
			"CREATE TABLE %s (id int);\n--> statement-breakpoint\nINSERT INTO %s VALUES (1);", e[0], e[0]))}
	}
	fsys["meta/_journal.json"] = &fstest.MapFile{Data: []byte(journal + "]}")}
	return fsys
}

func tableExists(t *testing.T, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, name string) bool {
	var ok bool
	require.NoError(t, pool.QueryRow(context.Background(), `SELECT to_regclass($1) IS NOT NULL`, name).Scan(&ok))
	return ok
}

// Drizzle runs every journal entry whose timestamp is newer than the most
// recently applied one, in journal order and in one transaction. The Go
// migrator must keep that exact rule, including its quirk of skipping an entry
// that was added with an older timestamp than one already applied.
func TestMigrateKeepsDrizzleSemantics(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Empty(t)

	first := syntheticFS([2]string{"m_a", "100"}, [2]string{"m_b", "200"})
	applied, err := db.Migrate(ctx, pool, first)
	require.NoError(t, err)
	require.Equal(t, 2, applied)
	require.True(t, tableExists(t, pool, "m_b"))

	// m_old has an older timestamp than m_b and is skipped; m_c runs.
	second := syntheticFS([2]string{"m_a", "100"}, [2]string{"m_b", "200"}, [2]string{"m_old", "150"}, [2]string{"m_c", "300"})
	applied, err = db.Migrate(ctx, pool, second)
	require.NoError(t, err)
	require.Equal(t, 1, applied)
	require.True(t, tableExists(t, pool, "m_c"))
	require.False(t, tableExists(t, pool, "m_old"))
}

func TestMigrateRollsBackAFailingBatch(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Empty(t)
	fsys := syntheticFS([2]string{"m_ok", "100"})
	fsys["m_bad.sql"] = &fstest.MapFile{Data: []byte("CREATE TABLE m_bad (id int);\n--> statement-breakpoint\nSELECT * FROM missing_table;")}
	fsys["meta/_journal.json"] = &fstest.MapFile{Data: []byte(`{"entries":[{"tag":"m_ok","when":100},{"tag":"m_bad","when":200}]}`)}

	_, err := db.Migrate(ctx, pool, fsys)
	require.ErrorContains(t, err, "m_bad")
	require.False(t, tableExists(t, pool, "m_ok"), "the whole batch is one transaction")
	var n int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM drizzle.__drizzle_migrations`).Scan(&n))
	require.Zero(t, n)
}

func TestReadMigrationsRejectsMissingFile(t *testing.T) {
	fsys := fstest.MapFS{"meta/_journal.json": &fstest.MapFile{Data: []byte(`{"entries":[{"tag":"nope","when":1}]}`)}}
	_, err := db.ReadMigrations(fsys)
	require.ErrorContains(t, err, "nope.sql")
}
