package episodes_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/episodes"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		episodes.Mount(r, d)
		return r
	})
	for _, u := range []string{"u", "other"} {
		fixture.User(t, e.Deps.Pool, u)
		fixture.Consents(t, e.Deps.Pool, u)
	}
	return e
}

func iso(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func create(t *testing.T, e *apitest.Env, user string, body map[string]any) map[string]any {
	t.Helper()
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: user, Body: body})
	require.Equal(t, 201, res.Status, string(res.Body))
	return res.Map(t)
}

func TestAuth(t *testing.T) {
	e := newEnv(t)
	for _, c := range []struct{ m, p string }{
		{"GET", "/api/episodes"}, {"POST", "/api/episodes"}, {"GET", "/api/episodes/recent"},
		{"GET", "/api/episodes/1"}, {"PATCH", "/api/episodes/1"}, {"DELETE", "/api/episodes/1"},
		{"GET", "/api/episodes/1/pain-readings"}, {"POST", "/api/episodes/1/pain-readings"},
		{"DELETE", "/api/episodes/1/pain-readings/7c1d3e2a-1b2c-4d5e-8f90-1234567890ab"},
	} {
		res := e.Do(apitest.Request{Method: c.m, Path: c.p, Body: map[string]any{}})
		require.Equal(t, 401, res.Status, c.p)
		require.Equal(t, `{"error":"Unauthorized"}`, string(res.Body))
	}
}

func TestQuickCreateAndOngoingRules(t *testing.T) {
	e := newEnv(t)
	ep := create(t, e, "u", map[string]any{"mode": "quick", "intensity": 3, "attackType": "headache"})
	require.Equal(t, true, ep["isOngoing"])
	require.Equal(t, "headache", ep["attackType"])
	require.Equal(t, "OTHER", ep["painLocation"])
	require.Equal(t, "unspecified", ep["painLocationOther"])
	require.Equal(t, ep["startTime"], ep["onsetAt"])
	require.Equal(t, []any{}, ep["medicationIntakes"])
	require.Nil(t, ep["weatherContext"])

	// A second ongoing headache conflicts.
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Body: map[string]any{"mode": "quick", "intensity": 2, "attackType": "headache"}})
	require.Equal(t, 409, res.Status)
	require.Equal(t, fmt.Sprintf(`{"error":"An attack is already in progress.","code":"ONGOING_EXISTS","ongoing":{"episodeId":%v,"attackType":"headache"}}`, ep["id"]), string(res.Body))

	// A migraine upgrades it: the headache ends when the migraine starts.
	start := time.Now().Add(-time.Minute).UTC().Truncate(time.Millisecond)
	mig := create(t, e, "u", map[string]any{"mode": "quick", "intensity": 4, "startTime": iso(start)})
	require.Equal(t, "migraine", mig["attackType"])
	old := e.Do(apitest.Request{Path: fmt.Sprintf("/api/episodes/%v", ep["id"]), User: "u"}).Map(t)
	require.Equal(t, false, old["isOngoing"])
	require.Equal(t, iso(start), old["endTime"])

	// Another user's ongoing attack never conflicts.
	create(t, e, "other", map[string]any{"mode": "quick", "intensity": 1})
}

func TestConsentRequired(t *testing.T) {
	e := newEnv(t)
	e.Exec(`UPDATE user_consent SET withdrawn_at = now() WHERE user_id = 'u' AND consent_type = 'health_data'`)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Body: map[string]any{"mode": "quick", "intensity": 3}})
	require.Equal(t, 403, res.Status)
	require.Equal(t, `{"error":"Health data consent required","code":"CONSENT_REQUIRED","message":"You must provide explicit consent for health data processing before logging episodes."}`, string(res.Body))
	require.Zero(t, e.Count(`SELECT count(*) FROM episode`))
}

func TestFullCreateValidationAndDiary(t *testing.T) {
	e := newEnv(t)
	start := time.Now().Add(-26 * time.Hour).UTC().Truncate(time.Second)
	end := start.Add(25 * time.Hour)
	ep := create(t, e, "u", map[string]any{
		"startTime": iso(start), "endTime": iso(end), "intensity": 4,
		"painLocation": "LEFT", "painType": "THROBBING", "symptoms": []string{"NAUSEA", "AURA"},
		"triggers": []string{"STRESS"}, "notes": "bad one",
	})
	require.Equal(t, false, ep["isOngoing"])
	require.Equal(t, []any{"NAUSEA", "AURA"}, ep["symptoms"])
	require.Equal(t, []any{}, ep["protectors"])
	// Spans two (or three) UTC days; each becomes a migraine day from the attack.
	require.GreaterOrEqual(t, e.Count(`SELECT count(*) FROM daily_diary_entry WHERE user_id = 'u' AND day_type = 'migraine_day' AND created_from = 'attack'`), 2)

	res := e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Body: map[string]any{
		"intensity": 9, "painLocation": "NOSE", "painType": "THROBBING", "isOngoing": true, "endTime": iso(end),
	}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"Validation error","details":[{"origin":"number","code":"too_big","maximum":5,"inclusive":true,"path":["intensity"],"message":"Too big: expected number to be <=5"},{"code":"invalid_value","values":["LEFT","RIGHT","FRONTAL","OCCIPITAL","WHOLE_HEAD","OTHER"],"path":["painLocation"],"message":"Invalid option: expected one of \"LEFT\"|\"RIGHT\"|\"FRONTAL\"|\"OCCIPITAL\"|\"WHOLE_HEAD\"|\"OTHER\""}]}`, string(res.Body))

	// Refinements only run on otherwise valid input.
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Body: map[string]any{
		"intensity": 2, "painLocation": "LEFT", "painType": "THROBBING", "startTime": iso(end), "endTime": iso(start),
	}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"Validation error","details":[{"code":"custom","path":["endTime"],"message":"endTime must be >= startTime"}]}`, string(res.Body))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Raw: "{oops"})
	require.Equal(t, 500, res.Status)
}

func TestListPaginationAndBounds(t *testing.T) {
	e := newEnv(t)
	base := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	for i := range 5 {
		s := base.Add(time.Duration(i) * 24 * time.Hour)
		create(t, e, "u", map[string]any{"startTime": iso(s), "endTime": iso(s.Add(time.Hour)), "intensity": 2, "painLocation": "LEFT", "painType": "PRESSURE"})
	}
	create(t, e, "other", map[string]any{"startTime": iso(base), "intensity": 2, "painLocation": "LEFT", "painType": "PRESSURE"})

	m := e.Do(apitest.Request{Path: "/api/episodes?page=2&limit=2", User: "u"}).Map(t)
	require.Equal(t, map[string]any{"page": float64(2), "limit": float64(2), "total": float64(5), "totalPages": float64(3)}, m["pagination"])
	eps := m["episodes"].([]any)
	require.Len(t, eps, 2)
	require.Equal(t, iso(base.Add(2*24*time.Hour)), eps[0].(map[string]any)["startTime"])

	m = e.Do(apitest.Request{Path: "/api/episodes?from=" + iso(base.Add(24*time.Hour)) + "&to=" + iso(base.Add(3*24*time.Hour)), User: "u"}).Map(t)
	require.Equal(t, float64(3), m["pagination"].(map[string]any)["total"])

	// Garbage paging falls back to defaults; an invalid date is a 500 as before.
	m = e.Do(apitest.Request{Path: "/api/episodes?page=abc&limit=-1", User: "u"}).Map(t)
	require.Equal(t, map[string]any{"page": float64(1), "limit": float64(20), "total": float64(5), "totalPages": float64(1)}, m["pagination"])
	require.Equal(t, 500, e.Do(apitest.Request{Path: "/api/episodes?from=nope", User: "u"}).Status)

	rec := e.Do(apitest.Request{Path: "/api/episodes/recent?limit=2", User: "u"}).Map(t)["episodes"].([]any)
	require.Len(t, rec, 2)
	require.Contains(t, rec[0], "medicationIntakes")
	require.NotContains(t, rec[0], "onsetAt")
	require.Equal(t, 400, e.Do(apitest.Request{Path: "/api/episodes/recent?limit=51", User: "u"}).Status)
	require.Equal(t, `{"error":"Invalid limit parameter. Must be between 1 and 50."}`, string(e.Do(apitest.Request{Path: "/api/episodes/recent?limit=x", User: "u"}).Body))
}

func TestDetailWithIntakesAndTreatment(t *testing.T) {
	e := newEnv(t)
	start := time.Now().Add(-3 * time.Hour).UTC().Truncate(time.Second)
	ep := create(t, e, "u", map[string]any{"startTime": iso(start), "endTime": iso(start.Add(2 * time.Hour)), "intensity": 3, "painLocation": "RIGHT", "painType": "STABBING"})
	id := ep["id"]
	sum := fixture.Medication(t, e.Deps.Pool, "u", "Sumatriptan")
	ibu := fixture.Medication(t, e.Deps.Pool, "u", "  Ibuprofen   400 ")
	e.Exec(`INSERT INTO acute_doses (id, user_id, medication_id, taken_at, dose, unit) VALUES
		('00000000-0000-4000-8000-000000000001', 'u', $1, $3, '50', 'mg'),
		('00000000-0000-4000-8000-000000000002', 'u', $1, $4, '50', 'mg'),
		('00000000-0000-4000-8000-000000000003', 'u', $2, $5, NULL, NULL)`, sum, ibu,
		start.Add(10*time.Minute), start.Add(50*time.Minute), start.Add(70*time.Minute))
	e.Exec(`INSERT INTO dose_outcomes (user_id, dose_id, helped) VALUES ('u', '00000000-0000-4000-8000-000000000002', 'partly')`)
	e.Exec(`INSERT INTO medication_intakes (user_id, user_medication_id, episode_id, taken_at, dose) VALUES ('u', $1, $2, $3, '400')`, ibu, id, start.Add(5*time.Minute))

	d := e.Do(apitest.Request{Path: fmt.Sprintf("/api/episodes/%v", id), User: "u"}).Map(t)
	intakes := d["medicationIntakes"].([]any)
	require.Len(t, intakes, 1)
	require.Equal(t, "Ibuprofen 400", intakes[0].(map[string]any)["label"])
	tr := d["attackTreatment"].(map[string]any)
	doses := tr["doses"].([]any)
	require.Len(t, doses, 3)
	require.Equal(t, true, doses[0].(map[string]any)["neededSecondDose"])
	require.Equal(t, true, doses[1].(map[string]any)["neededRescue"])
	require.Equal(t, "partly", doses[1].(map[string]any)["outcome"].(map[string]any)["helped"])
	require.Equal(t, map[string]any{"anySecondDose": true, "anyRescue": true}, tr["flags"])

	require.Equal(t, 404, e.Do(apitest.Request{Path: fmt.Sprintf("/api/episodes/%v", id), User: "other"}).Status)
	require.Equal(t, `{"error":"Invalid episode ID"}`, string(e.Do(apitest.Request{Path: "/api/episodes/abc", User: "u"}).Body))
	require.Equal(t, 404, e.Do(apitest.Request{Path: "/api/episodes/999999", User: "u"}).Status)
}

func TestPatchRules(t *testing.T) {
	e := newEnv(t)
	ep := create(t, e, "u", map[string]any{"mode": "quick", "intensity": 3, "startTime": iso(time.Now().Add(-10 * time.Minute))})
	path := fmt.Sprintf("/api/episodes/%v", ep["id"])

	res := e.Do(apitest.Request{Method: "PATCH", Path: path, User: "u", Body: map[string]any{"endTime": iso(time.Now())}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"Cannot set endTime when episode is ongoing"}`, string(res.Body))

	endedAt := time.Now().Add(-30 * time.Second).UTC().Truncate(time.Millisecond)
	res = e.Do(apitest.Request{Method: "PATCH", Path: path, User: "u", Body: map[string]any{"endNow": true, "endedAt": iso(endedAt), "notes": "done", "symptoms": []string{"NAUSEA"}}})
	require.Equal(t, 200, res.Status, string(res.Body))
	m := res.Map(t)
	require.Equal(t, false, m["isOngoing"])
	require.Equal(t, iso(endedAt), m["endTime"])
	require.Equal(t, "done", m["notes"])
	require.Contains(t, m, "attackTreatment")

	// Ending before the start is clamped to the start; in the future to now.
	require.Equal(t, `{"error":"Episode not found"}`, string(e.Do(apitest.Request{Method: "PATCH", Path: path, User: "other", Body: map[string]any{"notes": "x"}}).Body))
	res = e.Do(apitest.Request{Method: "PATCH", Path: path, User: "u", Body: map[string]any{"intensity": 0}})
	require.Equal(t, 400, res.Status)
	require.Contains(t, string(res.Body), `"Validation error"`)

	// Outside the 30-day window timeline edits are refused, descriptions are not.
	old := time.Now().Add(-40 * 24 * time.Hour).UTC().Truncate(time.Second)
	oldEp := create(t, e, "u", map[string]any{"startTime": iso(old), "endTime": iso(old.Add(time.Hour)), "intensity": 2, "painLocation": "LEFT", "painType": "PRESSURE"})
	oldPath := fmt.Sprintf("/api/episodes/%v", oldEp["id"])
	res = e.Do(apitest.Request{Method: "PATCH", Path: oldPath, User: "u", Body: map[string]any{"attackType": "headache"}})
	require.Equal(t, 403, res.Status)
	require.Equal(t, `{"error":"This attack is outside the editing window (last 30 days)."}`, string(res.Body))
	require.Equal(t, 200, e.Do(apitest.Request{Method: "PATCH", Path: oldPath, User: "u", Body: map[string]any{"notes": "late note"}}).Status)
}

func TestDeleteRecomputesDiary(t *testing.T) {
	e := newEnv(t)
	s := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	ep := create(t, e, "u", map[string]any{"startTime": iso(s), "endTime": iso(s.Add(time.Hour)), "intensity": 2, "painLocation": "LEFT", "painType": "PRESSURE"})
	require.Positive(t, e.Count(`SELECT count(*) FROM daily_diary_entry WHERE user_id = 'u'`))
	path := fmt.Sprintf("/api/episodes/%v", ep["id"])
	require.Equal(t, 404, e.Do(apitest.Request{Method: "DELETE", Path: path, User: "other"}).Status)
	res := e.Do(apitest.Request{Method: "DELETE", Path: path, User: "u"})
	require.Equal(t, `{"success":true}`, string(res.Body))
	require.Zero(t, e.Count(`SELECT count(*) FROM daily_diary_entry WHERE user_id = 'u'`))
	require.Equal(t, 404, e.Do(apitest.Request{Method: "DELETE", Path: path, User: "u"}).Status)
}

func TestIdempotentCreate(t *testing.T) {
	e := newEnv(t)
	h := map[string]string{"Idempotency-Key": "key-00000001"}
	first := e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Body: map[string]any{"mode": "quick", "intensity": 3}, Headers: h})
	require.Equal(t, 201, first.Status)
	again := e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Body: map[string]any{"mode": "quick", "intensity": 3}, Headers: h})
	require.Equal(t, 201, again.Status)
	require.Equal(t, "true", again.Header.Get("Idempotent-Replayed"))
	require.JSONEq(t, string(first.Body), string(again.Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM episode WHERE user_id = 'u'`))

	res := e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Body: map[string]any{}, Headers: map[string]string{"Idempotency-Key": "bad key!"}})
	require.Equal(t, `{"error":"Invalid Idempotency-Key","code":"INVALID_IDEMPOTENCY_KEY"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Body: map[string]any{}, Headers: map[string]string{"X-Offline-User": "someone"}})
	require.Equal(t, 409, res.Status)
	require.Equal(t, `{"error":"This entry was saved by a different account on this device.","code":"OFFLINE_USER_MISMATCH"}`, string(res.Body))

	// A failing write releases its key: the corrected retry goes through.
	k := map[string]string{"Idempotency-Key": "key-00000002"}
	require.Equal(t, 400, e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "other", Body: map[string]any{"mode": "quick", "intensity": 0}, Headers: k}).Status)
	require.Equal(t, 201, e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "other", Body: map[string]any{"mode": "quick", "intensity": 2}, Headers: k}).Status)

	// A fresh reservation without a response is in progress.
	e.Exec(`INSERT INTO idempotent_request (user_id, idempotency_key, route) VALUES ('u', 'key-00000003', 'episodes')`)
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/episodes", User: "u", Body: map[string]any{}, Headers: map[string]string{"Idempotency-Key": "key-00000003"}})
	require.Equal(t, 409, res.Status)
	require.Equal(t, "5", res.Header.Get("Retry-After"))
}

func TestPainReadings(t *testing.T) {
	e := newEnv(t)
	start := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	ep := create(t, e, "u", map[string]any{"mode": "quick", "intensity": 2, "startTime": iso(start)})
	base := fmt.Sprintf("/api/episodes/%v/pain-readings", ep["id"])

	res := e.Do(apitest.Request{Method: "POST", Path: base, User: "u", Body: map[string]any{"intensity": 4, "recordedAt": iso(start.Add(30 * time.Minute))}})
	require.Equal(t, 201, res.Status, string(res.Body))
	require.Equal(t, float64(4), res.Map(t)["peakIntensity"])
	first := res.Map(t)["reading"].(map[string]any)

	res = e.Do(apitest.Request{Method: "POST", Path: base, User: "u", Body: map[string]any{"intensity": 3}})
	require.Equal(t, float64(4), res.Map(t)["peakIntensity"])
	attack := e.Do(apitest.Request{Path: fmt.Sprintf("/api/episodes/%v", ep["id"]), User: "u"}).Map(t)
	require.Equal(t, float64(4), attack["intensity"], "the attack level is the peak reading")

	res = e.Do(apitest.Request{Method: "POST", Path: base, User: "u", Body: map[string]any{"intensity": 3, "recordedAt": iso(start.Add(-time.Hour))}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"The reading is before the attack started.","code":"VALIDATION_ERROR","details":{"reason":"before_start"}}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: base, User: "u", Body: map[string]any{"intensity": 3, "recordedAt": iso(time.Now().Add(time.Hour))}})
	require.Contains(t, string(res.Body), `"in_future"`)
	require.Equal(t, `{"error":"Invalid JSON body"}`, string(e.Do(apitest.Request{Method: "POST", Path: base, User: "u", Raw: "x"}).Body))
	require.Equal(t, 400, e.Do(apitest.Request{Method: "POST", Path: base, User: "u", Body: map[string]any{"intensity": 6}}).Status)

	list := e.Do(apitest.Request{Path: base, User: "u"}).Map(t)["readings"].([]any)
	require.Len(t, list, 2)
	require.Equal(t, first["id"], list[0].(map[string]any)["id"])

	// Another user cannot read, add or delete.
	require.Equal(t, 404, e.Do(apitest.Request{Path: base, User: "other"}).Status)
	require.Equal(t, 404, e.Do(apitest.Request{Method: "POST", Path: base, User: "other", Body: map[string]any{"intensity": 2}}).Status)
	require.Equal(t, 404, e.Do(apitest.Request{Method: "DELETE", Path: base + "/" + first["id"].(string), User: "other"}).Status)

	res = e.Do(apitest.Request{Method: "DELETE", Path: base + "/" + first["id"].(string), User: "u"})
	require.Equal(t, `{"success":true,"peakIntensity":3}`, string(res.Body))
	require.Equal(t, `{"error":"Invalid ID"}`, string(e.Do(apitest.Request{Method: "DELETE", Path: base + "/nope", User: "u"}).Body))
	require.Equal(t, `{"error":"Invalid episode ID"}`, string(e.Do(apitest.Request{Path: "/api/episodes/1a/pain-readings", User: "u"}).Body))

	e.Exec(`UPDATE user_consent SET withdrawn_at = now() WHERE user_id = 'u' AND consent_type = 'health_data'`)
	require.Equal(t, 403, e.Do(apitest.Request{Method: "POST", Path: base, User: "u", Body: map[string]any{"intensity": 2}}).Status)
}

func TestQuickAddEpisode(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/episode", User: "u", Body: map[string]any{"attackType": "headache"}})
	require.Equal(t, 201, res.Status, string(res.Body))
	head := res.Map(t)["episodeId"]

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/episode", User: "u", Raw: "not json"})
	require.Equal(t, 201, res.Status, "an unreadable body is {} and starts a migraine, upgrading the headache")
	m := res.Map(t)
	require.Equal(t, head, m["upgradedFromEpisodeId"])
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM episode WHERE id = $1 AND is_ongoing`, head))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/episode", User: "u", Body: map[string]any{}})
	require.Equal(t, 409, res.Status)
	require.Equal(t, fmt.Sprintf(`{"error":"An attack is already in progress.","code":"ONGOING_EXISTS","ongoing":{"episodeId":%v,"attackType":"migraine"}}`, m["episodeId"]), string(res.Body))

	day := time.Now().UTC().AddDate(0, 0, -5).Format("2006-01-02")
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/episode", User: "u", Body: map[string]any{"localDate": day}})
	require.Equal(t, 201, res.Status)
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM episode WHERE user_id = 'u' AND start_time = $1::date + interval '12 hours' AND NOT is_ongoing`, day))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM daily_diary_entry WHERE user_id = 'u' AND local_date = $1 AND day_type = 'migraine_day'`, day))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/episode", User: "other", Body: map[string]any{"startedAt": iso(time.Now().Add(-8 * 24 * time.Hour))}})
	require.Equal(t, `{"error":"Timestamp is too old to sync","code":"INVALID_STARTED_AT"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/episode", User: "other", Body: map[string]any{"localDate": "5 May"}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, 401, e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/episode"}).Status)
}

func TestReliefSessions(t *testing.T) {
	e := newEnv(t)
	ep := create(t, e, "u", map[string]any{"mode": "quick", "intensity": 3})
	started := time.Now().Add(-5 * time.Minute).UTC().Truncate(time.Millisecond)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/relief-sessions", User: "u", Body: map[string]any{
		"exercise": "breathing", "startedAt": iso(started), "durationSeconds": 180, "completed": true, "helped": "a_little", "episodeId": ep["id"],
	}})
	require.Equal(t, 201, res.Status, string(res.Body))
	require.Equal(t, fmt.Sprintf(`{"session":{"id":"%s","episodeId":%v,"exercise":"breathing","startedAt":"%s","durationSeconds":180,"completed":true,"helped":"a_little"}}`,
		res.Map(t)["session"].(map[string]any)["id"], ep["id"], iso(started)), string(res.Body))
	require.Equal(t, 201, e.Do(apitest.Request{Method: "POST", Path: "/api/relief-sessions", User: "u", Body: map[string]any{"exercise": "pmr", "startedAt": iso(started), "durationSeconds": 30, "completed": false}}).Status)

	require.Len(t, e.Do(apitest.Request{Path: "/api/relief-sessions", User: "u"}).Map(t)["sessions"], 2)
	require.Len(t, e.Do(apitest.Request{Path: fmt.Sprintf("/api/relief-sessions?episodeId=%v", ep["id"]), User: "u"}).Map(t)["sessions"], 1)
	require.Equal(t, `{"sessions":[]}`, string(e.Do(apitest.Request{Path: "/api/relief-sessions", User: "other"}).Body))
	for _, bad := range []string{"", "0", "-1", "1.5", "abc"} {
		require.Equal(t, `{"error":"Invalid episode ID"}`, string(e.Do(apitest.Request{Path: "/api/relief-sessions?episodeId=" + bad, User: "u"}).Body), bad)
	}

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/relief-sessions", User: "other", Body: map[string]any{"exercise": "pmr", "startedAt": iso(started), "durationSeconds": 30, "completed": true, "episodeId": ep["id"]}})
	require.Equal(t, `{"error":"Episode not found","code":"NOT_FOUND"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/relief-sessions", User: "u", Body: map[string]any{"exercise": "pmr", "startedAt": iso(time.Now().Add(time.Hour)), "durationSeconds": 30, "completed": true}})
	require.Equal(t, `{"error":"The session starts in the future.","code":"VALIDATION_ERROR","details":{"reason":"in_future"}}`, string(res.Body))
	require.Equal(t, 400, e.Do(apitest.Request{Method: "POST", Path: "/api/relief-sessions", User: "u", Body: map[string]any{"exercise": "yoga", "durationSeconds": 99999}}).Status)
	require.Equal(t, `{"error":"Invalid JSON body"}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/relief-sessions", User: "u", Raw: "{"}).Body))
}
