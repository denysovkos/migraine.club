package outcomes_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/outcomes"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

// now: 2026-03-15 12:00 UTC; users have no zone, so UTC.
var now = time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		outcomes.Mount(r, d)
		return r
	})
	e.Deps.Now = func() time.Time { return now }
	fixture.User(t, e.Deps.Pool, "u")
	fixture.User(t, e.Deps.Pool, "other")
	return e
}

func diary(e *apitest.Env, user, from, to string, migraineEveryOther bool) {
	kind := `'headache_free'`
	if migraineEveryOther {
		kind = `CASE WHEN extract(day FROM d)::int % 2 = 0 THEN 'migraine_day' ELSE 'headache_free' END`
	}
	e.Exec(`INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type)
		SELECT $1, d::date, 'UTC', `+kind+` FROM generate_series($2::date, $3::date, interval '1 day') d`, user, from, to)
}

func TestSettingsLifecycle(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, `{"baselineStart":null,"baselineEnd":null,"preferredWindowDays":28,"timezone":"UTC"}`,
		string(e.Do(apitest.Request{Path: "/api/outcomes/settings", User: "u"}).Body))
	res := e.Do(apitest.Request{Method: "PUT", Path: "/api/outcomes/settings", User: "u", Body: map[string]any{"baselineFrom": "2026-01-01", "preferredWindowDays": 14}})
	require.Equal(t, `{"baselineStart":"2026-01-01T00:00:00.000Z","baselineEnd":null,"preferredWindowDays":14,"timezone":"UTC"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/outcomes/settings", User: "u", Body: map[string]any{"baselineTo": "2026-02-01"}})
	require.Equal(t, `{"baselineStart":"2026-01-01T00:00:00.000Z","baselineEnd":"2026-02-01T00:00:00.000Z","preferredWindowDays":14,"timezone":"UTC"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/outcomes/settings", User: "u", Body: map[string]any{"baselineFrom": nil}})
	require.Nil(t, res.Map(t)["baselineStart"])
	require.Equal(t, 500, e.Do(apitest.Request{Method: "PUT", Path: "/api/outcomes/settings", User: "u", Body: map[string]any{"baselineFrom": "2026-02-30"}}).Status)
	require.Equal(t, 400, e.Do(apitest.Request{Method: "PUT", Path: "/api/outcomes/settings", User: "u", Body: map[string]any{"preferredWindowDays": 0}}).Status)
	require.Equal(t, float64(28), e.Do(apitest.Request{Path: "/api/outcomes/settings", User: "other"}).Map(t)["preferredWindowDays"])
}

func TestComputeWithBaselineAndResponder(t *testing.T) {
	e := newEnv(t)
	diary(e, "u", "2026-01-01", "2026-01-28", true) // 14 migraine days
	diary(e, "u", "2026-02-16", "2026-03-15", false)
	diary(e, "other", "2026-02-16", "2026-03-15", true)
	e.Exec(`INSERT INTO medication_intakes (user_id, taken_at, unit_is_custom, medication_name) VALUES
		('u', '2026-03-10T08:00:00Z', false, ' Ibu '), ('u', '2026-03-10T09:00:00Z', false, 'Asp'), ('u', '2026-03-11T09:00:00Z', false, '  ')`)
	e.Exec(`INSERT INTO user_outcome_settings (user_id, baseline_start, preferred_window_days) VALUES ('u', '2026-01-01T00:00:00', 28)`)

	m := e.Do(apitest.Request{Path: "/api/outcomes", User: "u"}).Map(t)
	require.Equal(t, float64(28), m["windowDays"])
	totals := m["totals"].(map[string]any)
	require.Equal(t, float64(0), totals["mmdMin"])
	require.Equal(t, float64(1), totals["acuteMedicationDays"]) // the blank-named intake is dropped
	require.Equal(t, map[string]any{"from": "2026-01-01", "to": "2026-01-28", "mmd": float64(14), "mhd": float64(14)}, m["baseline"])
	require.Equal(t, map[string]any{"status": "YES", "baselineMmd": float64(14), "currentMmd": float64(0)}, m["responder50"])
	daily := m["daily"].([]any)
	require.Len(t, daily, 28)
	require.Equal(t, []any{"Asp", "Ibu"}, daily[22].(map[string]any)["medications"])

	m = e.Do(apitest.Request{Path: "/api/outcomes?windowDays=60", User: "u"}).Map(t)
	require.Equal(t, map[string]any{"status": "NA", "reason": "INSUFFICIENT_COVERAGE"}, m["responder50"])

	require.Equal(t, 500, e.Do(apitest.Request{Path: "/api/outcomes?from=2026-02-30&to=2026-03-02", User: "u"}).Status)
	require.Equal(t, 400, e.Do(apitest.Request{Path: "/api/outcomes?windowDays=0", User: "u"}).Status)
	require.Nil(t, e.Do(apitest.Request{Path: "/api/outcomes", User: "other"}).Map(t)["baseline"])
}

func TestMonthly(t *testing.T) {
	e := newEnv(t)
	diary(e, "u", "2026-02-01", "2026-02-28", true)
	m := e.Do(apitest.Request{Path: "/api/outcomes/monthly?months=2", User: "u"}).Map(t)
	months := m["months"].([]any)
	require.Len(t, months, 2)
	feb := months[0].(map[string]any)
	require.Equal(t, "2026-02", feb["month"])
	require.Equal(t, float64(14), feb["mmd"])
	require.Equal(t, map[string]any{"totalDays": float64(28), "recordedDays": float64(28), "missingDays": float64(0)}, feb["coverage"])
	mar := months[1].(map[string]any)
	require.Equal(t, "2026-03", mar["month"])
	require.Equal(t, float64(31), mar["mmdMax"])
	require.Len(t, e.Do(apitest.Request{Path: "/api/outcomes/monthly", User: "u"}).Map(t)["months"], 12)
	require.Equal(t, 400, e.Do(apitest.Request{Path: "/api/outcomes/monthly?months=37", User: "u"}).Status)
}
