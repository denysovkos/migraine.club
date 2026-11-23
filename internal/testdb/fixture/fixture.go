// Package fixture inserts the rows tests commonly need, satisfying the
// schema's foreign keys.
package fixture

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// User inserts a user row (no-op if it exists).
func User(t testing.TB, pool *pgxpool.Pool, id string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `INSERT INTO "user" (id) VALUES ($1) ON CONFLICT DO NOTHING`, id)
	require.NoError(t, err)
}

// Consents gives the user active health_data, terms and privacy consents.
func Consents(t testing.TB, pool *pgxpool.Pool, userID string) {
	t.Helper()
	for _, c := range []string{"health_data", "terms", "privacy"} {
		_, err := pool.Exec(context.Background(),
			`INSERT INTO user_consent (user_id, consent_type, version) VALUES ($1, $2, '1.0') ON CONFLICT DO NOTHING`, userID, c)
		require.NoError(t, err)
	}
}

// Medication inserts a custom acute medication and returns its id.
func Medication(t testing.TB, pool *pgxpool.Pool, userID, name string) string {
	t.Helper()
	var id string
	require.NoError(t, pool.QueryRow(context.Background(),
		`INSERT INTO user_medications (user_id, custom_name, medication_class, is_acute) VALUES ($1, $2, 'triptan', true) RETURNING id`,
		userID, name).Scan(&id))
	return id
}
