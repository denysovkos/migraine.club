package usertz_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/testdb"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

func TestPrecedence(t *testing.T) {
	pool := testdb.New(t)
	qs := q.New(pool)
	ctx := context.Background()
	get := func(u string) string { z, err := usertz.Get(ctx, qs, u); require.NoError(t, err); return z }

	require.Equal(t, "UTC", get("nobody"))

	_, err := pool.Exec(ctx, `INSERT INTO user_weather_settings (user_id, lat, lon, timezone) VALUES ('u', 1, 2, 'America/New_York')`)
	require.NoError(t, err)
	require.Equal(t, "America/New_York", get("u"))

	fixture.User(t, pool, "u")
	_, err = pool.Exec(ctx, `INSERT INTO user_outcome_settings (user_id, timezone) VALUES ('u', 'Europe/Berlin')`)
	require.NoError(t, err)
	require.Equal(t, "Europe/Berlin", get("u"))
}
