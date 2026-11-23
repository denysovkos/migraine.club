package db_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

// The generated types must scan every column kind the schema uses.
func TestGeneratedTypesScan(t *testing.T) {
	pool := testdb.New(t)
	row, err := q.New(pool).ScanProbe(context.Background())
	require.NoError(t, err)
	require.Len(t, row.D, 10)
	require.Len(t, row.U, 36)
	require.False(t, row.Ts.IsZero())
	require.EqualValues(t, "12:30:00", row.T)
}
