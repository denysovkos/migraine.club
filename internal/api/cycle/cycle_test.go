package cycle_test

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/cycle"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		cycle.Mount(r, d)
		return r
	})
	fixture.User(t, e.Deps.Pool, "u")
	fixture.User(t, e.Deps.Pool, "other")
	return e
}

func TestSettings(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, `{"enabled":false,"includeInExports":false,"privacyMode":"local_only","perimenstrualWindowStartDays":-2,"perimenstrualWindowEndDays":3,"hormoneProfile":"unknown","updatedAt":null}`,
		string(e.Do(apitest.Request{Path: "/api/cycle/settings", User: "u"}).Body))
	res := e.Do(apitest.Request{Method: "PUT", Path: "/api/cycle/settings", User: "u", Body: map[string]any{"enabled": true, "perimenstrualWindowStartDays": -3, "hormoneProfile": "hrt"}})
	require.Equal(t, 200, res.Status)
	m := res.Map(t)
	require.Equal(t, true, m["enabled"])
	require.Equal(t, float64(-3), m["perimenstrualWindowStartDays"])
	require.NotNil(t, m["updatedAt"])
	require.Equal(t, `{"error":"Window end must be between 0 and 7"}`, string(e.Do(apitest.Request{Method: "PUT", Path: "/api/cycle/settings", User: "u", Body: map[string]any{"perimenstrualWindowEndDays": 9}}).Body))
	require.Equal(t, `{"error":"Window start must be between -5 and 0"}`, string(e.Do(apitest.Request{Method: "PUT", Path: "/api/cycle/settings", User: "u", Body: map[string]any{"perimenstrualWindowStartDays": 1}}).Body))
	require.Equal(t, 400, e.Do(apitest.Request{Method: "PUT", Path: "/api/cycle/settings", User: "u", Body: map[string]any{"privacyMode": "public"}}).Status)
	require.Equal(t, false, e.Do(apitest.Request{Path: "/api/cycle/settings", User: "other"}).Map(t)["enabled"])
}

func TestBleedingCalendarContextInsights(t *testing.T) {
	e := newEnv(t)
	put := func(day string, bleeding bool) {
		res := e.Do(apitest.Request{Method: "PUT", Path: "/api/cycle/bleeding", User: "u", Body: map[string]any{"localDate": day, "bleeding": bleeding}})
		require.Equal(t, 200, res.Status, string(res.Body))
	}
	put("2026-01-01", true)
	put("2026-01-02", true)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/cycle/bleeding", User: "u", Body: map[string]any{"localDate": "2026-01-29"}})
	require.Equal(t, `{"localDate":"2026-01-29","bleeding":true,"flow":"unspecified"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "PATCH", Path: "/api/cycle/bleeding", User: "u", Body: map[string]any{"localDate": "2026-01-29", "flow": "heavy"}})
	require.Equal(t, `{"localDate":"2026-01-29","bleeding":true,"flow":"heavy"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "PATCH", Path: "/api/cycle/bleeding", User: "u", Body: map[string]any{"localDate": "2026-01-15", "flow": "light"}})
	require.Equal(t, `{"localDate":"2026-01-15","bleeding":true,"flow":"light"}`, string(res.Body))
	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "DELETE", Path: "/api/cycle/bleeding?localDate=2026-01-15", User: "u"}).Body))

	e.Exec(`INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type) VALUES ('u', '2026-01-03', 'UTC', 'migraine_day')`)
	e.Exec(`INSERT INTO episode (user_id, attack_type, start_time, intensity, pain_location, pain_type) VALUES
		('u', 'migraine', '2025-12-30T10:00:00Z', 3, 'LEFT', 'PRESSURE'), ('u', 'migraine', '2026-01-15T10:00:00Z', 3, 'LEFT', 'PRESSURE')`)

	cal := e.Do(apitest.Request{Path: "/api/cycle/calendar?from=2026-01-01&to=2026-01-31", User: "u"}).Map(t)
	require.Equal(t, []any{"2026-01-01", "2026-01-29"}, cal["bleedingStartDates"])
	require.Equal(t, []any{"2026-01-03"}, cal["migraineDays"])
	require.Len(t, cal["days"], 3)

	ctx := e.Do(apitest.Request{Path: "/api/cycle/context?date=2026-01-03", User: "u"}).Map(t)
	require.Equal(t, float64(3), ctx["cycleDay"])
	require.Equal(t, float64(2), ctx["relativeDay"])
	require.Equal(t, true, ctx["withinPerimenstrualWindow"])

	ins := e.Do(apitest.Request{Path: "/api/cycle/insights?from=2025-12-01&to=2026-01-31", User: "u"}).Map(t)
	require.Equal(t, float64(2), ins["totalAttacks"])
	require.Equal(t, float64(1), ins["attacksInWindow"])
	require.Equal(t, 0.5, ins["inWindowPct"])
	require.Equal(t, true, ins["hasEnoughData"])

	require.Equal(t, `{"error":"from and to are required"}`, string(e.Do(apitest.Request{Path: "/api/cycle/calendar?from=2026-01-01", User: "u"}).Body))
	require.Equal(t, `{"error":"Invalid date"}`, string(e.Do(apitest.Request{Path: "/api/cycle/calendar?from=x&to=2026-01-02", User: "u"}).Body))
	require.Equal(t, `{"error":"Invalid date"}`, string(e.Do(apitest.Request{Path: "/api/cycle/context?date=1.1.2026", User: "u"}).Body))
	require.Equal(t, `{"error":"Invalid localDate"}`, string(e.Do(apitest.Request{Method: "DELETE", Path: "/api/cycle/bleeding", User: "u"}).Body))
	require.Equal(t, 400, e.Do(apitest.Request{Method: "PUT", Path: "/api/cycle/bleeding", User: "u", Body: map[string]any{"localDate": "x"}}).Status)

	// Isolation, and deleting everything.
	require.Empty(t, e.Do(apitest.Request{Path: "/api/cycle/calendar?from=2026-01-01&to=2026-01-31", User: "other"}).Map(t)["days"])
	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "DELETE", Path: "/api/cycle/data", User: "u"}).Body))
	require.Zero(t, e.Count(`SELECT count(*) FROM cycle_bleeding_day WHERE user_id = 'u'`))
	require.Zero(t, e.Count(`SELECT count(*) FROM cycle_settings WHERE user_id = 'u'`))
}
