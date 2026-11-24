package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/config"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

func TestMigrateAppliesPendingMigrationsOnce(t *testing.T) {
	url := testdb.Empty(t).Config().ConnString()
	ctx := context.Background()

	n, err := migrate(ctx, url)
	require.NoError(t, err)
	require.Positive(t, n)

	again, err := migrate(ctx, url)
	require.NoError(t, err)
	require.Zero(t, again, "a second run finds nothing to apply")
}

func TestMigrateNeedsADatabaseURL(t *testing.T) {
	_, err := migrate(context.Background(), "")
	require.ErrorIs(t, err, config.ErrNoDatabase)
}
