package jobs_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/jobs"
	"github.com/denysovkos/migraine.club/internal/service/push"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

func deps(t *testing.T, now time.Time) (jobs.Deps, func(string, ...any)) {
	pool := testdb.New(t)
	qs := q.New(pool)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	exec := func(sql string, args ...any) {
		_, err := pool.Exec(context.Background(), sql, args...)
		require.NoError(t, err, sql)
	}
	clock := func() time.Time { return now }
	return jobs.Deps{Q: qs, Log: log, Push: &push.Service{Q: qs, Log: log, Now: clock}, Now: clock}, exec
}

func body(t *testing.T, o *httpx.Object) map[string]any {
	b, _ := httpx.Marshal(o)
	var m map[string]any
	require.NoError(t, json.Unmarshal(b, &m))
	return m
}

func TestStaleEpisodesSkipWithoutPush(t *testing.T) {
	d, _ := deps(t, time.Now())
	res, err := d.StaleEpisodes(context.Background(), time.Now(), nil)
	require.NoError(t, err)
	require.Equal(t, true, body(t, res)["skippedNotConfigured"])
}

func TestMedicationRemindersWithoutDevice(t *testing.T) {
	now := time.Date(2026, 3, 18, 8, 10, 0, 0, time.UTC)
	d, exec := deps(t, now)
	exec(`INSERT INTO "user" (id) VALUES ('u1')`)
	exec(`INSERT INTO user_outcome_settings (user_id, timezone) VALUES ('u1', 'UTC')`)
	exec(`INSERT INTO preventive_plan (user_id, name, kind, schedule_type, schedule_payload, start_date, status, reminders_enabled, reminder_times)
		VALUES ('u1', 'Topiramate', 'oral', 'daily', '{}', '2026-03-01', 'active', true, '["08:00", "12:00"]')`)
	res, err := d.MedicationReminders(context.Background(), nil)
	require.NoError(t, err)
	m := body(t, res)
	require.Equal(t, 1.0, m["noSubscription"], "the 08:00 slot is due but no device received it")
	require.Equal(t, 0.0, m["sent"])
}
