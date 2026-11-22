package diary_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/service/diary"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

func at(s string) time.Time { t, _ := time.Parse(time.RFC3339, s); return t }

type dayRow struct {
	Date, DayType, CreatedFrom string
	Notes                      *string
}


func TestRecompute(t *testing.T) {
	pool := testdb.New(t)
	qs := q.New(pool)
	ctx := context.Background()
	read := func(user string) map[string]dayRow {
		rows, err := pool.Query(ctx, `SELECT local_date::text, day_type, created_from, notes FROM daily_diary_entry WHERE user_id = $1`, user)
		require.NoError(t, err)
		defer rows.Close()
		out := map[string]dayRow{}
		for rows.Next() {
			var r dayRow
			require.NoError(t, rows.Scan(&r.Date, &r.DayType, &r.CreatedFrom, &r.Notes))
			out[r.Date] = r
		}
		return out
	}
	episode := func(user, typ, start string, end *string, ongoing bool) {
		_, err := pool.Exec(ctx, `INSERT INTO episode (user_id, attack_type, start_time, end_time, is_ongoing, intensity, pain_location, pain_type)
			VALUES ($1, $2, $3, $4, $5, 3, 'LEFT', 'THROBBING')`, user, typ, at(start), endPtr(end), ongoing)
		require.NoError(t, err)
	}

	t.Run("midnight-spanning migraine marks both days", func(t *testing.T) {
		end := "2024-01-02T01:00:00Z"
		episode("u1", "migraine", "2024-01-01T23:00:00Z", &end, false)
		res, err := diary.Recompute(ctx, qs, "u1", []string{"2024-01-02", "2024-01-01", "2024-01-01"}, "UTC", at(end))
		require.NoError(t, err)
		require.Equal(t, []string{"2024-01-01", "2024-01-02"}, res.AffectedDates)
		got := read("u1")
		require.Equal(t, "migraine_day", got["2024-01-01"].DayType)
		require.Equal(t, "attack", got["2024-01-01"].CreatedFrom)
		require.Equal(t, "migraine_day", got["2024-01-02"].DayType)
	})

	t.Run("migraine beats headache, user provenance and notes are kept", func(t *testing.T) {
		_, err := pool.Exec(ctx, `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type, created_from, notes)
			VALUES ('u2', '2024-02-01', 'UTC', 'headache_free', 'user', 'mine')`)
		require.NoError(t, err)
		end := "2024-02-01T12:00:00Z"
		episode("u2", "headache", "2024-02-01T10:00:00Z", &end, false)
		episode("u2", "migraine", "2024-02-01T15:00:00Z", nil, false)
		_, err = diary.Recompute(ctx, qs, "u2", []string{"2024-02-01"}, "UTC", at(end))
		require.NoError(t, err)
		r := read("u2")["2024-02-01"]
		require.Equal(t, "migraine_day", r.DayType)
		require.Equal(t, "user", r.CreatedFrom)
		require.Equal(t, "mine", *r.Notes)
	})

	t.Run("rows that only existed for an attack are deleted, user rows stay", func(t *testing.T) {
		_, err := pool.Exec(ctx, `INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type, created_from) VALUES
			('u3', '2024-01-01', 'UTC', 'headache_day', 'attack'),
			('u3', '2024-01-02', 'UTC', 'headache_day', 'user'),
			('u3', '2024-01-03', 'UTC', 'headache_free', 'attack')`)
		require.NoError(t, err)
		_, err = diary.Recompute(ctx, qs, "u3", []string{"2024-01-01", "2024-01-02", "2024-01-03"}, "UTC", at("2024-01-04T00:00:00Z"))
		require.NoError(t, err)
		got := read("u3")
		require.NotContains(t, got, "2024-01-01")
		require.Equal(t, "headache_day", got["2024-01-02"].DayType)
		require.Equal(t, "headache_free", got["2024-01-03"].DayType)
	})

	t.Run("ongoing attack runs until now, in the user's zone", func(t *testing.T) {
		episode("u4", "migraine", "2024-03-30T21:30:00Z", nil, true)
		_, err := diary.Recompute(ctx, qs, "u4", []string{"2024-03-30", "2024-03-31", "2024-04-01"}, "Europe/Berlin", at("2024-03-31T09:00:00Z"))
		require.NoError(t, err)
		got := read("u4")
		require.Contains(t, got, "2024-03-30") // 22:30 Berlin
		require.Contains(t, got, "2024-03-31")
		require.NotContains(t, got, "2024-04-01")
	})

	t.Run("other users' attacks are ignored", func(t *testing.T) {
		episode("other", "migraine", "2024-05-01T10:00:00Z", nil, false)
		_, err := diary.Recompute(ctx, qs, "u5", []string{"2024-05-01"}, "UTC", at("2024-05-02T00:00:00Z"))
		require.NoError(t, err)
		require.Empty(t, read("u5"))
	})

	t.Run("empty input is a no-op and the zone is looked up", func(t *testing.T) {
		_, err := pool.Exec(ctx, `INSERT INTO user_weather_settings (user_id, lat, lon, timezone) VALUES ('u6', 52.5, 13.4, 'Europe/Berlin')`)
		require.NoError(t, err)
		res, err := diary.Recompute(ctx, qs, "u6", []string{"", ""}, "", time.Now())
		require.NoError(t, err)
		require.Equal(t, "Europe/Berlin", res.Timezone)
		require.Empty(t, res.AffectedDates)
	})
}

func endPtr(s *string) *time.Time {
	if s == nil {
		return nil
	}
	v := at(*s)
	return &v
}
