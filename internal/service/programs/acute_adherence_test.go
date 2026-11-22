package programs_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/service/programs"
	"github.com/denysovkos/migraine.club/internal/testdb"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

func f(v float64) *float64 { return &v }

func TestAcuteSignal(t *testing.T) {
	require.Equal(t, "na", programs.AcuteSignal(30, nil))
	require.Equal(t, "na", programs.AcuteSignal(30, f(-1)))
	require.Equal(t, "hit", programs.AcuteSignal(30, f(30)))
	require.Equal(t, "hit", programs.AcuteSignal(30, f(0)))
	require.Equal(t, "miss", programs.AcuteSignal(30, f(31)))
}

func TestRecordAcuteAdherence(t *testing.T) {
	pool := testdb.New(t)
	qs := q.New(pool)
	ctx := context.Background()
	exec := func(sql string, args ...any) { _, err := pool.Exec(ctx, sql, args...); require.NoError(t, err) }

	var attack int32
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO episode (user_id, start_time, onset_at, intensity, pain_location, pain_type)
		VALUES ('u', $1, $2, 3, 'LEFT', 'THROBBING') RETURNING id`,
		time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC), time.Date(2026, 3, 10, 11, 0, 0, 0, time.UTC)).Scan(&attack))

	// No enrollment: nothing recorded.
	require.NoError(t, programs.RecordAcuteAdherence(ctx, qs, "u", attack, ""))
	var n int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM program_adherence_event`).Scan(&n))
	require.Zero(t, n)

	exec(`INSERT INTO program_enrollment (user_id, program_id, status, target_payload, start_date, baseline_window_start, baseline_window_end, evaluation_window_start, evaluation_window_end, timezone)
		VALUES ('u', 'acute-med-timing', 'active', '{"acuteWindowMinutes": 45}', '2026-03-01', '2026-02-01', '2026-02-28', '2026-03-01', '2026-05-31', 'UTC')`)

	// Enrolled, no dose yet: na.
	require.NoError(t, programs.RecordAcuteAdherence(ctx, qs, "u", attack, ""))
	var signal, source string
	var payload string
	require.NoError(t, pool.QueryRow(ctx, `SELECT signal, source, payload::text FROM program_adherence_event`).Scan(&signal, &source, &payload))
	require.Equal(t, "na", signal)
	require.Equal(t, "computed", source)
	require.JSONEq(t, `{"onsetToDoseMinutes": null}`, payload)

	// The earliest dose counts, measured from onset_at: 40 minutes is a hit.
	med := fixture.Medication(t, pool, "u", "Sumatriptan")
	exec(`INSERT INTO acute_doses (user_id, attack_id, medication_id, taken_at) VALUES
		('u', $1, $4, $2), ('u', $1, $4, $3)`, attack,
		time.Date(2026, 3, 10, 11, 40, 29, 0, time.UTC), time.Date(2026, 3, 10, 13, 0, 0, 0, time.UTC), med)
	require.NoError(t, programs.RecordAcuteAdherence(ctx, qs, "u", attack, "episode"))
	require.NoError(t, pool.QueryRow(ctx, `SELECT signal, source, payload::text FROM program_adherence_event`).Scan(&signal, &source, &payload))
	require.Equal(t, "hit", signal)
	require.Equal(t, "episode", source)
	require.JSONEq(t, `{"onsetToDoseMinutes": 40}`, payload)
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM program_adherence_event`).Scan(&n))
	require.Equal(t, 1, n, "idempotent per attack")

	// Attacks before the enrollment start are ignored.
	var early int32
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO episode (user_id, start_time, intensity, pain_location, pain_type)
		VALUES ('u', '2026-02-20T10:00:00Z', 3, 'LEFT', 'THROBBING') RETURNING id`).Scan(&early))
	require.NoError(t, programs.RecordAcuteAdherence(ctx, qs, "u", early, ""))
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM program_adherence_event`).Scan(&n))
	require.Equal(t, 1, n)

	// Another user's attack id is not theirs to record.
	require.NoError(t, programs.RecordAcuteAdherence(ctx, qs, "someone-else", attack, ""))
}
