package db

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
)

func TestDrizzleWrapsDatabaseErrors(t *testing.T) {
	pg := &pgconn.PgError{Code: "22P02", Message: "invalid input syntax for type uuid"}
	err := Drizzle(pg, `select "id" from "t" where "t"."id" = $1 limit $2`, "abc", 1, nil)
	require.EqualError(t, err, "Failed query: select \"id\" from \"t\" where \"t\".\"id\" = $1 limit $2\nparams: abc,1,")
	require.ErrorIs(t, err, pg)

	require.NoError(t, Drizzle(nil, "x"))
	require.Same(t, context.Canceled, Drizzle(context.Canceled, "x"))
	require.False(t, errors.As(Drizzle(context.Canceled, "x"), new(*QueryError)))
}
