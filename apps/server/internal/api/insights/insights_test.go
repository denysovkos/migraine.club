package insights_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/insights"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

const (
	stress = "bbbbbbbb-0000-4000-8000-000000000001"
	walk   = "bbbbbbbb-0000-4000-8000-000000000002"
)

func newEnv(t *testing.T, enabled bool) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		insights.Mount(r, d)
		return r
	})
	e.Deps.Cfg.EnableInsights = enabled
	e.Deps.Now = func() time.Time { return now }
	for _, u := range []string{"u", "other", "noconsent"} {
		fixture.User(t, e.Deps.Pool, u)
	}
	fixture.Consents(t, e.Deps.Pool, "u")
	fixture.Consents(t, e.Deps.Pool, "other")
	return e
}

// seed builds 14 weekly attacks, stress 6h before each, and walks on the
// days in between, with full diary coverage.
func seed(e *apitest.Env) {
	e.Exec(`INSERT INTO factor (id, user_id, key, type, display_name) VALUES ($1, 'u', 'stress', 'trigger', 'Stress'), ($2, 'u', 'walk', 'protector', 'Walk')`, stress, walk)
	e.Exec(`INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type)
		SELECT 'u', d::date, 'UTC', 'headache_free' FROM generate_series('2025-11-25'::date, '2026-03-01'::date, interval '1 day') d`)
	e.Exec(`INSERT INTO episode (user_id, attack_type, start_time, end_time, intensity, pain_location, pain_type)
		SELECT 'u', 'migraine', '2026-03-01'::timestamptz - (n * interval '6 day') + interval '10 hour',
			'2026-03-01'::timestamptz - (n * interval '6 day') + interval '13 hour', 3, 'LEFT', 'PRESSURE' FROM generate_series(1, 14) n`)
	e.Exec(`INSERT INTO factor_event (user_id, factor_id, occurred_at, source)
		SELECT 'u', $1::uuid, '2026-03-01'::timestamptz - (n * interval '6 day') + interval '4 hour', 'user' FROM generate_series(1, 14) n
		UNION ALL SELECT 'u', $2::uuid, '2026-03-01'::timestamptz - (n * interval '1 day') + interval '18 hour', 'user'
			FROM generate_series(1, 85) n WHERE n % 6 NOT IN (0, 1)`, stress, walk)
}

func TestDisabledAndConsent(t *testing.T) {
	e := newEnv(t, false)
	require.Equal(t, `{"state":"disabled","message":"Insights are not enabled."}`, string(e.Do(apitest.Request{Path: "/api/insights", User: "u"}).Body))
	require.Equal(t, `{"error":"Insights are not enabled."}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/insights/recompute", User: "u"}).Body))

	e = newEnv(t, true)
	res := e.Do(apitest.Request{Path: "/api/insights", User: "noconsent"})
	require.Equal(t, 403, res.Status)
	require.Equal(t, `{"state":"consent_required","message":"Health data consent required."}`, string(res.Body))
	require.Equal(t, 401, e.Do(apitest.Request{Path: "/api/insights"}).Status)
	require.Equal(t, 500, e.Do(apitest.Request{Path: "/api/insights?windowDays=45", User: "u"}).Status)
}

func TestComputeCacheAndRecompute(t *testing.T) {
	e := newEnv(t, true)
	seed(e)
	m := e.Do(apitest.Request{Path: "/api/insights", User: "u"}).Map(t)
	require.Equal(t, "ok", m["status"])
	p := m["payload"].(map[string]any)
	require.Equal(t, "ready", p["status"])
	buckets := p["buckets"].([]any)
	inc := buckets[0].(map[string]any)["items"].([]any)
	dec := buckets[1].(map[string]any)["items"].([]any)
	require.Equal(t, "Stress", inc[0].(map[string]any)["factorName"])
	require.Equal(t, "high", inc[0].(map[string]any)["confidence"])
	require.Equal(t, "Walk", dec[0].(map[string]any)["factorName"])
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM insights_cache WHERE user_id = 'u' AND window_days = 90 AND NOT stale`))

	// Served from cache now; a recompute within five minutes is refused.
	cached := e.Do(apitest.Request{Path: "/api/insights", User: "u"}).Map(t)
	require.Equal(t, "ready", cached["status"])
	require.Equal(t, `{"error":"Insights were recently refreshed."}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/insights/recompute", User: "u"}).Body))

	// A stale row is recomputed.
	e.Exec(`UPDATE insights_cache SET stale = true`)
	require.Equal(t, "ok", e.Do(apitest.Request{Path: "/api/insights", User: "u"}).Map(t)["status"])

	// Another user sees only their own (insufficient) data.
	other := e.Do(apitest.Request{Path: "/api/insights", User: "other"}).Map(t)
	require.Equal(t, "insufficient_data", other["status"])
	require.Equal(t, 500, e.Do(apitest.Request{Method: "POST", Path: "/api/insights/recompute", User: "u", Body: map[string]any{"windowDays": 7}}).Status)
	require.Equal(t, "insufficient_data", e.Do(apitest.Request{Method: "POST", Path: "/api/insights/recompute", User: "u", Body: map[string]any{"windowDays": "30"}}).Map(t)["status"])
}

func TestTestPlans(t *testing.T) {
	e := newEnv(t, true)
	seed(e)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/insights/test-plans", User: "u", Body: map[string]any{"factorId": stress, "direction": "reduce", "startDate": "2026-02-01", "durationDays": 14}})
	require.Equal(t, 200, res.Status)
	id := res.Map(t)["id"].(string)
	require.Equal(t, 500, e.Do(apitest.Request{Method: "POST", Path: "/api/insights/test-plans", User: "u", Body: map[string]any{"factorId": "x"}}).Status)

	plans := e.Do(apitest.Request{Path: "/api/insights/test-plans", User: "u"}).Map(t)["plans"].([]any)
	require.Len(t, plans, 1)
	p := plans[0].(map[string]any)
	require.Equal(t, "Stress", p["factorName"])
	require.Equal(t, "2026-02-14", p["endDate"])
	cmp := p["comparison"].(map[string]any)
	// Attacks every 6 days from Feb 23 back: Jan 18, 24, 30 before; Feb 5, 11 during.
	require.Equal(t, map[string]any{"attackStarts": float64(3), "attackStartsPerWeek": 1.5, "diaryCoveragePct": float64(1)}, cmp["before"])
	require.Equal(t, map[string]any{"attackStarts": float64(2), "attackStartsPerWeek": float64(1), "diaryCoveragePct": float64(1)}, cmp["during"])

	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "PATCH", Path: "/api/insights/test-plans/" + id, User: "other", Body: map[string]any{"status": "completed"}}).Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM insight_test_plan WHERE id = $1 AND status = 'active'`, id))
	e.Do(apitest.Request{Method: "PATCH", Path: "/api/insights/test-plans/" + id, User: "u", Body: map[string]any{"status": "completed", "notes": "done", "reminderEnabled": false}})
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM insight_test_plan WHERE id = $1 AND status = 'completed' AND completed_at IS NOT NULL AND notes = 'done' AND NOT reminder_enabled`, id))
	require.Empty(t, e.Do(apitest.Request{Path: "/api/insights/test-plans?status=active", User: "u"}).Map(t)["plans"])
	require.Empty(t, e.Do(apitest.Request{Path: "/api/insights/test-plans", User: "other"}).Map(t)["plans"])
	require.Equal(t, 500, e.Do(apitest.Request{Path: "/api/insights/test-plans?status=done", User: "u"}).Status)
}
