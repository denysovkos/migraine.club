package intake_test

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/intake"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

// Ported from IntakeService.test.ts, complete.test.ts and
// seedFromIntake.test.ts, against a real database instead of mocks.

var now = time.Date(2026, 3, 10, 9, 0, 0, 0, time.UTC)

const (
	suma  = "aaaaaaaa-0000-4000-8000-000000000101"
	riza  = "aaaaaaaa-0000-4000-8000-000000000102"
	plain = "aaaaaaaa-0000-4000-8000-000000000103"
)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		intake.Mount(r, d)
		return r
	})
	e.Deps.Now = func() time.Time { return now }
	for _, u := range []string{"u", "other", "noconsent"} {
		fixture.User(t, e.Deps.Pool, u)
	}
	fixture.Consents(t, e.Deps.Pool, "u")
	fixture.Consents(t, e.Deps.Pool, "other")
	e.Exec(`INSERT INTO medications_catalog (id, canonical_name, canonical_name_lc, search_text, tags) VALUES
		($1, 'Suma', 'suma', 'suma', '["triptan","acute"]'), ($2, 'Riza', 'riza', 'riza', '["triptan"]'), ($3, 'Plain', 'plain', 'plain', '["acute"]')`,
		suma, riza, plain)
	return e
}

func patch(t *testing.T, e *apitest.Env, user, block string, value any) apitest.Response {
	t.Helper()
	return e.Do(apitest.Request{Method: "PATCH", Path: "/api/intake", User: user, Body: map[string]any{"block": block, "value": value}})
}

const empty = `{"frequency":null,"triggers":null,"medications":null,"habits":null}`

func TestGetDefaultsAuthAndConsent(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, `{"status":"in_progress","currentStep":0,"version":1,"answers":`+empty+`,"completedAt":null}`,
		string(e.Do(apitest.Request{Path: "/api/intake", User: "u"}).Body))
	require.Equal(t, 401, e.Do(apitest.Request{Path: "/api/intake"}).Status)
	require.Equal(t, 403, e.Do(apitest.Request{Method: "POST", Path: "/api/intake/complete", User: "noconsent"}).Status)
}

func TestPatchStepsAndOrder(t *testing.T) {
	e := newEnv(t)
	res := patch(t, e, "u", "triggers", map[string]any{"custom": []any{" A "}, "keys": []any{"stress"}})
	require.Equal(t, `{"status":"in_progress","currentStep":2,"version":1,"answers":{"frequency":null,"triggers":{"keys":["stress"],"custom":["A"]},"medications":null,"habits":null},"completedAt":null}`, string(res.Body))
	// Never moves backwards, and keeps the other blocks.
	res = patch(t, e, "u", "frequency", map[string]any{"band": "1_3"})
	m := res.Map(t)
	require.Equal(t, float64(2), m["currentStep"])
	require.Equal(t, map[string]any{"keys": []any{"stress"}, "custom": []any{"A"}}, m["answers"].(map[string]any)["triggers"])
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM intake_response WHERE user_id = 'u' AND current_step = 2`))

	// A stale write cannot regress the stored step (GREATEST in SQL).
	e.Exec(`UPDATE intake_response SET current_step = 4 WHERE user_id = 'u'`)
	patch(t, e, "u", "frequency", nil)
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM intake_response WHERE user_id = 'u' AND current_step = 4`))

	// Another user's row is untouched.
	patch(t, e, "other", "habits", map[string]any{"sleepTrouble": nil, "typicalBed": nil, "typicalWake": nil, "medTiming": "varies"})
	require.Equal(t, float64(4), e.Do(apitest.Request{Path: "/api/intake", User: "u"}).Map(t)["currentStep"])
	require.Nil(t, e.Do(apitest.Request{Path: "/api/intake", User: "u"}).Map(t)["answers"].(map[string]any)["habits"])
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM intake_response WHERE user_id = 'other' AND current_step = 4`))
}

func TestPatchValidation(t *testing.T) {
	e := newEnv(t)
	res := patch(t, e, "u", "mood", map[string]any{})
	require.Equal(t, 400, res.Status)
	require.Equal(t, "Validation error", res.Map(t)["error"])
	res = patch(t, e, "u", "medications", map[string]any{"acute": []any{map[string]any{"defaultDose": "x"}}, "preventive": []any{}})
	require.Equal(t, 400, res.Status)
	require.Contains(t, string(res.Body), "catalogMedicationId or customName is required")
	res = e.Do(apitest.Request{Method: "PATCH", Path: "/api/intake", User: "u", Raw: "{"})
	require.Equal(t, `{"error":"Internal server error"}`, string(res.Body))
}

func TestSkip(t *testing.T) {
	e := newEnv(t)
	patch(t, e, "u", "frequency", map[string]any{"band": "lt1"})
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/intake/skip", User: "u"}).Map(t)
	require.Equal(t, "skipped", res["status"])
	require.Equal(t, float64(1), res["currentStep"])
	require.Equal(t, map[string]any{"band": "lt1"}, res["answers"].(map[string]any)["frequency"])
}

func TestStoredAnswersDegradeToEmpty(t *testing.T) {
	e := newEnv(t)
	e.Exec(`INSERT INTO intake_response (user_id, version, status, current_step, answers) VALUES ('u', 1, 'in_progress', 1, '{"frequency":{"band":"never"}}'),
		('other', 9, 'in_progress', 1, '{"frequency":{"band":"lt1"}}')`)
	for _, u := range []string{"u", "other"} {
		got := e.Do(apitest.Request{Path: "/api/intake", User: u}).Map(t)
		require.Equal(t, map[string]any{"frequency": nil, "triggers": nil, "medications": nil, "habits": nil}, got["answers"], u)
	}
}

func TestCompleteSeedsOnce(t *testing.T) {
	e := newEnv(t)
	e.Exec(`INSERT INTO user_medications (user_id, catalog_medication_id, medication_class) VALUES ('u', $1, 'triptan')`, plain)
	e.Exec(`INSERT INTO user_medications (user_id, custom_name, medication_class) VALUES ('u', 'Old  Mix', 'triptan'), ('other', 'Theirs', 'triptan')`)
	patch(t, e, "u", "medications", map[string]any{
		"acute": []any{
			map[string]any{"catalogMedicationId": suma},
			map[string]any{"catalogMedicationId": riza, "medicationClass": "opioid"},
			map[string]any{"catalogMedicationId": plain},
			map[string]any{"customName": " old mix "},
			map[string]any{"customName": "Theirs"},
			map[string]any{"customName": "  New   One "},
			map[string]any{"customName": "new one"},
		},
		"preventive": []any{
			map[string]any{"name": "Topi", "kind": "oral", "scheduleType": "daily"},
			map[string]any{"name": "Shot", "kind": "injection", "scheduleType": "every_n_weeks", "schedulePayload": map[string]any{"n": 4}, "startDate": "2026-04-01"},
		},
	})
	patch(t, e, "u", "triggers", map[string]any{"keys": []any{"stress"}, "custom": []any{}})

	res := e.Do(apitest.Request{Method: "POST", Path: "/api/intake/complete", User: "u"})
	require.Equal(t, 200, res.Status, string(res.Body))
	m := res.Map(t)
	require.Equal(t, "completed", m["status"])
	require.Equal(t, float64(4), m["currentStep"])
	require.Equal(t, "2026-03-10T09:00:00.000Z", m["completedAt"])

	rows := e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u'`)
	require.Equal(t, 2+4, rows) // suma, riza, Theirs, New One added; plain and old mix were owned
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u' AND catalog_medication_id = $1 AND medication_class = 'triptan' AND is_pinned`, suma))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u' AND catalog_medication_id = $1 AND medication_class = 'opioid' AND is_pinned`, riza))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u' AND custom_name = 'Theirs' AND medication_class = 'non_opioid_simple_analgesic' AND is_pinned`))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u' AND custom_name = 'New One' AND NOT is_pinned`))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM preventive_plan WHERE user_id = 'u' AND name = 'Topi' AND start_date = '2026-03-10' AND NOT reminders_enabled AND schedule_payload = '{}'`))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM preventive_plan WHERE user_id = 'u' AND name = 'Shot' AND start_date = '2026-04-01'`))
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM factor WHERE user_id = 'u' AND key = 'intake.trigger:stress'`))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM intake_response WHERE user_id = 'u' AND jsonb_array_length(seeded->'userMedicationIds') = 4
		AND jsonb_array_length(seeded->'preventivePlanIds') = 2 AND jsonb_array_length(seeded->'factorIds') = 0`))

	// A second complete and a skip change nothing.
	e.Do(apitest.Request{Method: "POST", Path: "/api/intake/complete", User: "u"})
	require.Equal(t, "completed", e.Do(apitest.Request{Method: "POST", Path: "/api/intake/skip", User: "u"}).Map(t)["status"])
	require.Equal(t, 6, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u'`))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'other'`))
}

func TestConcurrentCompleteSeedsOnce(t *testing.T) {
	e := newEnv(t)
	patch(t, e, "u", "medications", map[string]any{"acute": []any{map[string]any{"customName": "Once"}}, "preventive": []any{}})
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			e.Do(apitest.Request{Method: "POST", Path: "/api/intake/complete", User: "u"})
		})
	}
	wg.Wait()
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u' AND custom_name = 'Once'`))
}

func TestCompleteRollsBackOnSeedFailure(t *testing.T) {
	e := newEnv(t)
	patch(t, e, "u", "medications", map[string]any{"acute": []any{map[string]any{"customName": "Kept out"}},
		"preventive": []any{map[string]any{"name": "Bad", "kind": "oral", "scheduleType": "daily", "startDate": "2026-13-01"}}})
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/intake/complete", User: "u"})
	require.Equal(t, `{"error":"Internal server error"}`, string(res.Body))
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u'`))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM intake_response WHERE user_id = 'u' AND status = 'in_progress'`))
}

func TestCompleteWithoutAnswers(t *testing.T) {
	e := newEnv(t)
	m := e.Do(apitest.Request{Method: "POST", Path: "/api/intake/complete", User: "u"}).Map(t)
	require.Equal(t, "completed", m["status"])
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u'`))
}

// Preserved upstream bug (docs/migration/STATUS.md): the custom-trigger
// insert uses ON CONFLICT (user_id, key), which Postgres cannot match to the
// partial index factor_user_key_uidx (WHERE key IS NOT NULL). Node answered
// 500 and rolled back; so does the port, until the fix lands in both.
func TestCompleteWithCustomTriggersFailsLikeNode(t *testing.T) {
	e := newEnv(t)
	patch(t, e, "u", "medications", map[string]any{"acute": []any{map[string]any{"customName": "Rolled back"}}, "preventive": []any{}})
	patch(t, e, "u", "triggers", map[string]any{"keys": []any{}, "custom": []any{"Red wine"}})
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/intake/complete", User: "u"})
	require.Equal(t, 500, res.Status)
	require.Equal(t, `{"error":"Internal server error"}`, string(res.Body))
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u'`))
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM factor WHERE user_id = 'u'`))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM intake_response WHERE user_id = 'u' AND status = 'in_progress'`))
}
