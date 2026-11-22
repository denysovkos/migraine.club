package diary_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/diary"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		diary.Mount(r, d)
		return r
	})
	fixture.User(t, e.Deps.Pool, "u")
	fixture.User(t, e.Deps.Pool, "other")
	return e
}

func today() string { return time.Now().UTC().Format("2006-01-02") }
func daysAgo(n int) string {
	return time.Now().UTC().AddDate(0, 0, -n).Format("2006-01-02")
}

func put(e *apitest.Env, user, date string, patch map[string]any) apitest.Response {
	return e.Do(apitest.Request{Method: "PUT", Path: "/api/diary/entry", User: user, Body: map[string]any{"localDate": date, "patch": patch}})
}

func episode(e *apitest.Env, user, typ string, start, end time.Time) int {
	var id int
	require.NoError(e.T, e.Deps.Pool.QueryRow(e.T.Context(), `INSERT INTO episode (user_id, attack_type, start_time, end_time, intensity, pain_location, pain_type)
		VALUES ($1, $2, $3, $4, 3, 'LEFT', 'THROBBING') RETURNING id`, user, typ, start, end).Scan(&id))
	return id
}

func TestAuth(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/api/diary/range?from=2026-01-01&to=2026-01-31", "/api/diary/today", "/api/diary/overlap?from=2026-01-01&to=2026-01-02", "/api/diary/day?date=2026-01-01"} {
		require.Equal(t, 401, e.Do(apitest.Request{Path: p}).Status, p)
	}
	require.Equal(t, 401, e.Do(apitest.Request{Method: "PUT", Path: "/api/diary/entry", Body: map[string]any{}}).Status)
}

func TestEntryLifecycle(t *testing.T) {
	e := newEnv(t)
	res := put(e, "u", today(), map[string]any{"impact": 2})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"dayType is required to create a diary entry","code":"VALIDATION_ERROR"}`, string(res.Body))

	res = put(e, "u", today(), map[string]any{"dayType": "headache_free", "notes": "fine", "bedTimeLocal": "23:15", "wakeTimeLocal": "07:05"})
	require.Equal(t, 200, res.Status, string(res.Body))
	m := res.Map(t)
	require.Equal(t, "headache_free", m["dayType"])
	require.Equal(t, "user", m["createdFrom"])
	require.Equal(t, "23:15:00", m["bedTimeLocal"])
	require.Equal(t, today(), m["localDate"])

	// Patch keeps what it does not mention; null clears.
	res = put(e, "u", today(), map[string]any{"impact": 3, "notes": nil})
	m = res.Map(t)
	require.Equal(t, float64(3), m["impact"])
	require.Nil(t, m["notes"])
	require.Equal(t, "23:15:00", m["bedTimeLocal"])

	td := e.Do(apitest.Request{Path: "/api/diary/today", User: "u"}).Map(t)
	require.Equal(t, today(), td["todayLocalDate"])
	require.Equal(t, "UTC", td["timezone"])
	require.Equal(t, m["id"], td["entry"].(map[string]any)["id"])
	require.Nil(t, e.Do(apitest.Request{Path: "/api/diary/today", User: "other"}).Map(t)["entry"])

	res = put(e, "u", daysAgo(30), map[string]any{"dayType": "headache_free"})
	require.Equal(t, 403, res.Status)
	require.Equal(t, fmt.Sprintf(`{"error":"This day is outside the editing window (last 30 days).","code":"NOT_EDITABLE","details":{"localDate":"%s"}}`, daysAgo(30)), string(res.Body))
	require.Equal(t, 200, put(e, "u", daysAgo(29), map[string]any{"dayType": "headache_day"}).Status)

	res = put(e, "u", today(), map[string]any{"impact": 9, "bedTimeLocal": "25:00"})
	require.Equal(t, 400, res.Status)
	require.Contains(t, string(res.Body), `"Validation error"`)
	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/diary/entry", User: "u", Body: map[string]any{"localDate": "01.01.2026", "patch": map[string]any{}}})
	require.Equal(t, `{"error":"Validation error","details":[{"origin":"string","code":"invalid_format","format":"regex","pattern":"/^\\d{4}-\\d{2}-\\d{2}$/","path":["localDate"],"message":"Invalid string: must match pattern /^\\d{4}-\\d{2}-\\d{2}$/"}]}`, string(res.Body))
}

func TestAttackRules(t *testing.T) {
	e := newEnv(t)
	day := daysAgo(2)
	start, _ := time.Parse("2006-01-02", day)
	episode(e, "u", "migraine", start.Add(10*time.Hour), start.Add(12*time.Hour))

	res := put(e, "u", day, map[string]any{"dayType": "headache_free"})
	require.Equal(t, 400, res.Status)
	require.Equal(t, fmt.Sprintf(`{"error":"Not available because a migraine attack exists for this day.","code":"MIGRAINE_DAY_REQUIRED","details":{"localDate":"%s"}}`, day), string(res.Body))
	// Notes-only edits keep the derived migraine day.
	res = put(e, "u", day, map[string]any{"dayType": "migraine_day", "notes": "rough"})
	require.Equal(t, "migraine_day", res.Map(t)["dayType"])

	// Only a headache: headache_free is refused, migraine_day promotes it.
	hday := daysAgo(3)
	hs, _ := time.Parse("2006-01-02", hday)
	hid := episode(e, "u", "headache", hs.Add(8*time.Hour), hs.Add(9*time.Hour))
	res = put(e, "u", hday, map[string]any{"dayType": "headache_free"})
	require.Equal(t, "HEADACHE_FREE_NOT_ALLOWED", res.Map(t)["code"])
	res = put(e, "u", hday, map[string]any{"dayType": "migraine_day"})
	require.Equal(t, "migraine_day", res.Map(t)["dayType"])
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM episode WHERE id = $1 AND attack_type = 'migraine'`, hid))

	// Range shows attack days, medication days and coverage, and fixes the day rows.
	med := fixture.Medication(t, e.Deps.Pool, "u", "Ibu")
	e.Exec(`INSERT INTO acute_doses (user_id, medication_id, taken_at) VALUES ('u', $1, $2)`, med, start.Add(11*time.Hour))
	rg := e.Do(apitest.Request{Path: fmt.Sprintf("/api/diary/range?from=%s&to=%s", daysAgo(4), today()), User: "u"}).Map(t)
	require.Equal(t, []any{hday, day}, rg["attackDays"])
	require.Equal(t, []any{day}, rg["medicationDays"])
	require.Equal(t, map[string]any{"totalDays": float64(5), "recordedDays": float64(2), "missingDays": float64(3)}, rg["coverage"])
	require.Equal(t, []any{hday, day}, e.Do(apitest.Request{Path: fmt.Sprintf("/api/diary/overlap?from=%s&to=%s", daysAgo(4), today()), User: "u"}).Map(t)["overlapDays"])

	dd := e.Do(apitest.Request{Path: "/api/diary/day?date=" + day, User: "u"}).Map(t)
	require.Len(t, dd["attacks"], 1)
	meds := dd["medicationIntakes"].([]any)
	require.Len(t, meds, 1)
	require.Equal(t, "Ibu", meds[0].(map[string]any)["label"])
	require.Equal(t, []any{}, dd["preventiveIntakes"])

	// Nothing of this is visible to another user.
	o := e.Do(apitest.Request{Path: "/api/diary/day?date=" + day, User: "other"}).Map(t)
	require.Nil(t, o["entry"])
	require.Equal(t, []any{}, o["attacks"])
}

func TestQueryValidation(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Path: "/api/diary/range?from=2026-01-01", User: "u"})
	require.Equal(t, `{"error":"Validation error","details":[{"expected":"string","code":"invalid_type","path":["to"],"message":"Invalid input: expected string, received null"}]}`, string(res.Body))
	res = e.Do(apitest.Request{Path: "/api/diary/range?from=2026-02-01&to=2026-01-01", User: "u"})
	require.Equal(t, `{"error":"Invalid date range","code":"VALIDATION_ERROR"}`, string(res.Body))
	require.Equal(t, 400, e.Do(apitest.Request{Path: "/api/diary/day", User: "u"}).Status)
}
