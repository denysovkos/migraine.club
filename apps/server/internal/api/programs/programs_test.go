package programs_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/programs"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

var now = time.Date(2026, 3, 10, 9, 0, 0, 0, time.UTC)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		programs.Mount(r, d)
		return r
	})
	e.Deps.Now = func() time.Time { return now }
	fixture.User(t, e.Deps.Pool, "u")
	fixture.User(t, e.Deps.Pool, "other")
	return e
}

func enable(t *testing.T, e *apitest.Env, user string) {
	t.Helper()
	res := e.Do(apitest.Request{Method: "PATCH", Path: "/api/programs/settings", User: user, Body: map[string]any{"enabled": true}})
	require.Equal(t, 200, res.Status, string(res.Body))
}

func TestSettingsAndGate(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, `{"enabled":false,"notificationsConfig":{},"updatedAt":null}`, string(e.Do(apitest.Request{Path: "/api/programs/settings", User: "u"}).Body))
	require.Equal(t, `{"error":"Module disabled"}`, string(e.Do(apitest.Request{Path: "/api/programs", User: "u"}).Body))
	res := e.Do(apitest.Request{Method: "PATCH", Path: "/api/programs/settings", User: "u", Body: map[string]any{"enabled": true, "notificationsConfig": map[string]any{"weeklyDigest": true}}})
	m := res.Map(t)
	require.Equal(t, true, m["enabled"])
	res = e.Do(apitest.Request{Method: "PATCH", Path: "/api/programs/settings", User: "u", Body: map[string]any{"notificationsConfig": map[string]any{"windDown": false}}})
	require.Equal(t, map[string]any{"windDown": false, "weeklyDigest": true}, res.Map(t)["notificationsConfig"])
	require.Equal(t, 400, e.Do(apitest.Request{Method: "PATCH", Path: "/api/programs/settings", User: "u", Body: map[string]any{"enabled": "yes"}}).Status)
	require.Equal(t, `{"error":"Module disabled"}`, string(e.Do(apitest.Request{Path: "/api/programs", User: "other"}).Body))

	list := e.Do(apitest.Request{Path: "/api/programs", User: "u"}).Map(t)["programs"].([]any)
	require.Equal(t, "acute-med-timing", list[0].(map[string]any)["id"])
	require.Equal(t, float64(4), list[0].(map[string]any)["citationCount"])
}

func TestDetailLocale(t *testing.T) {
	e := newEnv(t)
	enable(t, e, "u")
	en := e.Do(apitest.Request{Path: "/api/programs/sleep-regularity", User: "u"}).Map(t)
	fr := e.Do(apitest.Request{Path: "/api/programs/sleep-regularity?locale=fr", User: "u"}).Map(t)
	uk := e.Do(apitest.Request{Path: "/api/programs/sleep-regularity", User: "u", Headers: map[string]string{"Accept-Language": "uk-UA,uk;q=0.9"}}).Map(t)
	de := e.Do(apitest.Request{Path: "/api/programs/sleep-regularity", User: "u", Headers: map[string]string{"Accept-Language": "de-DE"}}).Map(t)
	require.NotEqual(t, en["body"], fr["body"])
	require.NotEqual(t, en["body"], uk["body"])
	require.Equal(t, en["body"], de["body"])
	require.Equal(t, map[string]any{"bedTime": "23:00", "wakeTime": "07:00", "toleranceMinutes": float64(30)}, en["defaultTarget"])
	require.Nil(t, en["activeEnrollment"])
	require.Equal(t, `{"error":"Not found"}`, string(e.Do(apitest.Request{Path: "/api/programs/nope", User: "u"}).Body))
}

func TestEnrollmentLifecycle(t *testing.T) {
	e := newEnv(t)
	enable(t, e, "u")
	enable(t, e, "other")
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/programs/sleep-regularity/enroll", User: "u",
		Body: map[string]any{"targetPayload": map[string]any{"wakeTime": "07:00", "bedTime": "23:00", "toleranceMinutes": 30, "x": 1}}})
	require.Equal(t, 201, res.Status, string(res.Body))
	m := res.Map(t)
	id := m["id"].(float64)
	require.Equal(t, map[string]any{"bedTime": "23:00", "wakeTime": "07:00", "toleranceMinutes": float64(30)}, m["targetPayload"])
	require.Equal(t, "2026-03-10", m["startDate"])
	require.Equal(t, "2026-02-10", m["baselineWindowStart"])
	require.Equal(t, "2026-03-24", m["evaluationWindowStart"])
	require.Equal(t, "2026-04-20", m["evaluationWindowEnd"])

	require.Equal(t, `{"error":"User already enrolled in this program"}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/programs/sleep-regularity/enroll", User: "u",
		Body: map[string]any{"targetPayload": map[string]any{"acuteWindowMinutes": 30}}}).Body))
	require.Equal(t, `{"error":"Unknown program: nope"}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/programs/nope/enroll", User: "u",
		Body: map[string]any{"targetPayload": map[string]any{"acuteWindowMinutes": 30}}}).Body))
	require.Equal(t, "Validation", e.Do(apitest.Request{Method: "POST", Path: "/api/programs/acute-med-timing/enroll", User: "u",
		Body: map[string]any{"targetPayload": map[string]any{"acuteWindowMinutes": 0}}}).Map(t)["error"])

	// Another user cannot touch the enrollment.
	require.Equal(t, `{"error":"Enrollment not found"}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/programs/x/pause", User: "other", Body: map[string]any{"enrollmentId": id}}).Body))
	require.Equal(t, "paused", e.Do(apitest.Request{Method: "POST", Path: "/api/programs/x/pause", User: "u", Body: map[string]any{"enrollmentId": id}}).Map(t)["status"])
	require.Equal(t, "active", e.Do(apitest.Request{Method: "POST", Path: "/api/programs/x/resume", User: "u", Body: map[string]any{"enrollmentId": id}}).Map(t)["status"])

	// Logging a sleep day writes the adherence event the chip reads back.
	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/programs/sleep-regularity/log", User: "u",
		Body: map[string]any{"localDate": "2026-03-10", "bedTimeLocal": "23:10", "wakeTimeLocal": "07:05"}}).Body))
	require.Equal(t, `{"today":"2026-03-10","signal":"hit","payload":{"bedTime":"23:10","wakeTime":"07:05"}}`,
		string(e.Do(apitest.Request{Path: "/api/programs/sleep-regularity/today-status", User: "u"}).Body))
	prog := e.Do(apitest.Request{Path: "/api/programs/sleep-regularity/progress", User: "u"}).Map(t)
	require.Equal(t, "low", prog["confidence"])
	require.Equal(t, float64(1), prog["summary"].(map[string]any)["adherence"])

	ended := e.Do(apitest.Request{Method: "POST", Path: "/api/programs/x/end", User: "u", Body: map[string]any{"enrollmentId": id}}).Map(t)
	require.Equal(t, "ended", ended["status"])
	require.Equal(t, "2026-03-10", ended["endDate"])
	require.Equal(t, `{"error":"No active enrollment"}`, string(e.Do(apitest.Request{Path: "/api/programs/sleep-regularity/progress", User: "u"}).Body))

	huge := e.Do(apitest.Request{Method: "POST", Path: "/api/programs/x/pause", User: "u", Body: map[string]any{"enrollmentId": 99999999999}})
	require.Equal(t, 400, huge.Status)
	require.Contains(t, huge.Map(t)["error"], `Failed query: update "program_enrollment" set "status" = $1, "updated_at" = $2 where`)
	require.Contains(t, huge.Map(t)["error"], "params: paused,2026-03-10T09:00:00.000Z,99999999999,u")
}

func TestRecommendationsAndAttack(t *testing.T) {
	e := newEnv(t)
	enable(t, e, "u")
	e.Exec(`INSERT INTO intake_response (user_id, status, answers) VALUES ('u', 'completed', '{"habits":{"sleepTrouble":"sometimes","typicalBed":null,"typicalWake":null,"medTiming":"varies"}}')`)
	recs := e.Do(apitest.Request{Path: "/api/programs/recommendations", User: "u"}).Map(t)["recommendations"].([]any)
	require.Equal(t, []any{
		map[string]any{"id": "acute-med-timing", "reason": "You told us your acute medication timing varies.", "title": "Acute Med Timing"},
		map[string]any{"id": "sleep-regularity", "reason": "You told us you sometimes have trouble sleeping.", "title": "Sleep Regularity"},
	}, recs)
	e.Do(apitest.Request{Method: "POST", Path: "/api/programs/recommendations/sleep-regularity/dismiss", User: "u"})
	require.Len(t, e.Do(apitest.Request{Path: "/api/programs/recommendations", User: "u"}).Map(t)["recommendations"], 1)

	require.Equal(t, `{"error":"Not enrolled"}`, string(e.Do(apitest.Request{Path: "/api/programs/acute-med-timing/attack/1", User: "u"}).Body))
	e.Do(apitest.Request{Method: "POST", Path: "/api/programs/acute-med-timing/enroll", User: "u", Body: map[string]any{"targetPayload": map[string]any{"acuteWindowMinutes": 30}}})
	medID := fixture.Medication(t, e.Deps.Pool, "u", "Triptan")
	e.Exec(`INSERT INTO episode (id, user_id, attack_type, start_time, onset_at, intensity, pain_location, pain_type)
		VALUES (16, 'u', 'migraine', '2026-03-09T10:00:00Z', '2026-03-09T09:40:00Z', 3, 'LEFT', 'PRESSURE')`)
	e.Exec(`INSERT INTO acute_doses (user_id, medication_id, attack_id, taken_at) VALUES ('u', $1, 16, '2026-03-09T10:05:00Z'), ('u', $1, 16, '2026-03-09T09:55:00Z')`, medID)
	require.Equal(t, `{"targetMinutes":30,"onsetToDoseMinutes":15,"signal":"hit"}`, string(e.Do(apitest.Request{Path: "/api/programs/acute-med-timing/attack/0x10", User: "u"}).Body))
	require.Equal(t, `{"error":"Bad attack id"}`, string(e.Do(apitest.Request{Path: "/api/programs/acute-med-timing/attack/abc", User: "u"}).Body))
	require.Equal(t, 500, e.Do(apitest.Request{Path: "/api/programs/acute-med-timing/attack/1.5", User: "u"}).Status)
	require.Equal(t, `{"error":"Attack not found"}`, string(e.Do(apitest.Request{Path: "/api/programs/acute-med-timing/attack/17", User: "u"}).Body))
}
