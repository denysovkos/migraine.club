package db

import (
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

// QueryError is Drizzle's DrizzleQueryError: a database error re-thrown with
// the statement and its parameters. Routes that answered 500 with
// `error.message` exposed this text, so the Go port reproduces it for the
// statements reachable with user input (an id that is not a UUID).
type QueryError struct {
	SQL    string
	Params []any
	Cause  error
}

func (e *QueryError) Error() string {
	ps := make([]string, len(e.Params))
	for i, p := range e.Params {
		// Array.prototype.join: null and undefined become "".
		switch v := p.(type) {
		case nil:
		case int:
			ps[i] = jsx.FormatNumber(float64(v))
		default:
			ps[i] = jsx.String(v)
		}
	}
	return "Failed query: " + e.SQL + "\nparams: " + strings.Join(ps, ",")
}

func (e *QueryError) Unwrap() error { return e.Cause }

// Drizzle wraps err like Drizzle's session did when the database rejected the
// statement; other errors (context, connection) pass through unchanged.
func Drizzle(err error, sql string, params ...any) error {
	var pg *pgconn.PgError
	if err == nil || !errors.As(err, &pg) {
		return err
	}
	return &QueryError{SQL: sql, Params: params, Cause: err}
}

// Int4 narrows an id that JavaScript passed as a number to an integer
// column. Out of range, it is the error Postgres raised for that parameter.
func Int4(n int64) (int32, error) {
	if n < -2147483648 || n > 2147483647 {
		return 0, &pgconn.PgError{Code: "22003", Severity: "ERROR",
			Message: `value "` + strconv.FormatInt(n, 10) + `" is out of range for type integer`}
	}
	return int32(n), nil
}
