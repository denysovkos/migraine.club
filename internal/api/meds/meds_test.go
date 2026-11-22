package meds_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/meds"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	svc "github.com/denysovkos/migraine.club/internal/service/meds"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		meds.Mount(r, d)
		return r
	})
	for _, u := range []string{"u", "other"} {
		fixture.User(t, e.Deps.Pool, u)
		fixture.Consents(t, e.Deps.Pool, u)
	}
	return e
}

func iso(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func ongoing(e *apitest.Env, user string, start time.Time) int {
	var id int
	require.NoError(e.T, e.Deps.Pool.QueryRow(e.T.Context(), `INSERT INTO episode (user_id, start_time, is_ongoing, intensity, pain_location, pain_type)
		VALUES ($1, $2, true, 3, 'OTHER', 'OTHER') RETURNING id`, user, start).Scan(&id))
	return id
}

func TestAuthAndConsent(t *testing.T) {
	e := newEnv(t)
	for _, c := range []struct{ m, p string }{
		{"GET", "/api/quick-add/suggestions"}, {"POST", "/api/quick-add/medication-intake"},
		{"DELETE", "/api/quick-add/medication-intake/x"}, {"PATCH", "/api/quick-add/medication-intake/x"},
		{"POST", "/api/acute-doses"}, {"POST", "/api/dose-outcomes"},
	} {
		require.Equal(t, 401, e.Do(apitest.Request{Method: c.m, Path: c.p, Body: map[string]any{}}).Status, c.p)
	}
	e.Exec(`UPDATE user_consent SET withdrawn_at = now() WHERE user_id = 'u' AND consent_type = 'privacy'`)
	res := e.Do(apitest.Request{Path: "/api/quick-add/suggestions", User: "u"})
	require.Equal(t, 403, res.Status)
	require.Equal(t, `{"error":"Health data consent required","code":"CONSENT_REQUIRED","message":"You must provide explicit consent for health data processing before logging."}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/dose-outcomes", User: "u", Body: map[string]any{}})
	require.Equal(t, `{"error":"Health data consent required","code":"CONSENT_REQUIRED"}`, string(res.Body))
}

func TestIntakeLinksOngoingAttackAndSuggests(t *testing.T) {
	e := newEnv(t)
	attack := ongoing(e, "u", time.Now().Add(-time.Hour))

	res := e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/medication-intake", User: "u",
		Body: map[string]any{"customName": "  Ibuprofen   400 ", "dose": " 400 ", "unit": "mg", "recordAcuteDose": true}})
	require.Equal(t, 201, res.Status, string(res.Body))
	m := res.Map(t)
	require.Equal(t, float64(attack), m["linkedEpisodeId"])
	require.NotEmpty(t, m["acuteDoseId"])
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE user_id = 'u' AND custom_name = 'Ibuprofen 400'`))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM acute_doses WHERE user_id = 'u' AND attack_id = $1 AND dose = '400'`, attack))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE last_used_dose = '400' AND last_used_unit = 'mg'`))

	// The same custom name (any case) reuses the medication.
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/medication-intake", User: "u", Body: map[string]any{"customName": "ibuprofen 400"}})
	require.Equal(t, 201, res.Status)
	require.Equal(t, m["userMedicationId"], res.Map(t)["userMedicationId"])
	require.NotContains(t, res.Map(t), "acuteDoseId")

	sug := e.Do(apitest.Request{Path: "/api/quick-add/suggestions", User: "u"}).Map(t)
	require.Equal(t, true, sug["hasOngoingEpisode"])
	top := sug["topMeds"].([]any)
	require.Len(t, top, 1)
	first := top[0].(map[string]any)
	require.Equal(t, "Ibuprofen 400", first["label"])
	require.Equal(t, "400", first["suggestedDose"])
	require.Equal(t, "mg", first["suggestedUnit"])

	// Another user sees nothing.
	o := e.Do(apitest.Request{Path: "/api/quick-add/suggestions", User: "other"})
	require.Equal(t, `{"topMeds":[],"hasOngoingEpisode":false}`, string(o.Body))
}

func TestLateSyncedIntakeKeepsTimeAndLinksOnlyStartedAttack(t *testing.T) {
	e := newEnv(t)
	ongoing(e, "u", time.Now().Add(-10*time.Minute))
	taken := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Millisecond)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/medication-intake", User: "u", Body: map[string]any{"customName": "Naproxen", "takenAt": iso(taken)}})
	require.Equal(t, 201, res.Status)
	require.NotContains(t, res.Map(t), "linkedEpisodeId")
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM medication_intakes WHERE taken_at = $1 AND episode_id IS NULL`, taken))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/medication-intake", User: "u", Body: map[string]any{"customName": "Naproxen", "takenAt": iso(time.Now().Add(-8 * 24 * time.Hour))}})
	require.Equal(t, `{"error":"Timestamp is too old to sync","code":"INVALID_TAKEN_AT"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/medication-intake", User: "u", Body: map[string]any{"dose": "1"}})
	require.Equal(t, `{"error":"Validation error","details":[{"code":"custom","path":[],"message":"userMedicationId, catalogMedicationId, or customName is required"}]}`, string(res.Body))

	// Linking another user's attack or medication is refused.
	theirs := ongoing(e, "other", time.Now().Add(-time.Hour))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/medication-intake", User: "u", Body: map[string]any{"customName": "X", "episodeId": theirs}})
	require.Equal(t, `{"error":"Episode not found"}`, string(res.Body))
	med := fixture.Medication(t, e.Deps.Pool, "other", "Theirs")
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/medication-intake", User: "u", Body: map[string]any{"userMedicationId": med}})
	require.Equal(t, `{"error":"User medication not found"}`, string(res.Body))
}

func TestPatchAndDeleteIntake(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/quick-add/medication-intake", User: "u", Body: map[string]any{"customName": "Ibu", "dose": "200"}})
	id := res.Map(t)["intakeId"].(string)

	require.Equal(t, `{"success":true}`, string(e.Do(apitest.Request{Method: "PATCH", Path: "/api/quick-add/medication-intake/intake:" + id, User: "u", Body: map[string]any{"dose": nil, "unit": "mg"}}).Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM medication_intakes WHERE id = $1 AND dose IS NULL AND unit = 'mg'`, id))
	// Nothing to set is the old unhandled error: 500 with no body.
	res = e.Do(apitest.Request{Method: "PATCH", Path: "/api/quick-add/medication-intake/" + id, User: "u", Body: map[string]any{"takenAt": nil}})
	require.Equal(t, 500, res.Status)
	require.Empty(t, res.Body)
	require.Equal(t, 404, e.Do(apitest.Request{Method: "PATCH", Path: "/api/quick-add/medication-intake/" + id, User: "other", Body: map[string]any{"unit": "g"}}).Status)
	require.Equal(t, 500, e.Do(apitest.Request{Method: "PATCH", Path: "/api/quick-add/medication-intake/not-a-uuid", User: "u", Body: map[string]any{"unit": "g"}}).Status)

	require.Equal(t, 404, e.Do(apitest.Request{Method: "DELETE", Path: "/api/quick-add/medication-intake/" + id, User: "other"}).Status)
	require.Equal(t, `{"success":true}`, string(e.Do(apitest.Request{Method: "DELETE", Path: "/api/quick-add/medication-intake/" + id, User: "u"}).Body))
	require.Equal(t, `{"error":"Not found"}`, string(e.Do(apitest.Request{Method: "DELETE", Path: "/api/quick-add/medication-intake/" + id, User: "u"}).Body))
}

func TestAcuteDoseAndOutcome(t *testing.T) {
	e := newEnv(t)
	med := fixture.Medication(t, e.Deps.Pool, "u", "Sumatriptan")
	attack := ongoing(e, "u", time.Now().Add(-time.Hour))

	res := e.Do(apitest.Request{Method: "POST", Path: "/api/acute-doses", User: "u", Body: map[string]any{
		"medicationId": med, "attackId": attack, "dose": " 50 ", "unit": "mg", "notes": "with\tfood\n\n now",
	}})
	require.Equal(t, 201, res.Status, string(res.Body))
	m := res.Map(t)
	require.Equal(t, float64(attack), m["attackId"])
	doseID := m["doseId"].(string)
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM acute_doses WHERE id = $1 AND dose = '50' AND notes = 'with food now'`, doseID))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/acute-doses", User: "u", Body: map[string]any{"medicationId": med, "attackId": 999999}})
	require.Equal(t, `{"error":"Attack not found"}`, string(res.Body))
	require.Equal(t, 500, res.Status)
	other := fixture.Medication(t, e.Deps.Pool, "other", "X")
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/acute-doses", User: "u", Body: map[string]any{"medicationId": other}})
	require.Equal(t, `{"error":"Medication not found"}`, string(res.Body))
	require.Equal(t, 400, e.Do(apitest.Request{Method: "POST", Path: "/api/acute-doses", User: "u", Body: map[string]any{"medicationId": "x"}}).Status)

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/dose-outcomes", User: "u", Body: map[string]any{"doseId": doseID, "helped": "partly", "timeToReliefMinutes": 45}})
	require.Equal(t, 200, res.Status, string(res.Body))
	outcome := res.Map(t)["outcomeId"]
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/dose-outcomes", User: "u", Body: map[string]any{"doseId": doseID, "helped": "yes"}})
	require.Equal(t, outcome, res.Map(t)["outcomeId"], "one outcome per dose")
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM dose_outcomes WHERE dose_id = $1 AND helped = 'yes' AND time_to_relief_minutes IS NULL`, doseID))
	require.Equal(t, `{"error":"Dose not found"}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/dose-outcomes", User: "other", Body: map[string]any{"doseId": doseID, "helped": "no"}}).Body))
	require.Equal(t, 400, e.Do(apitest.Request{Method: "POST", Path: "/api/dose-outcomes", User: "u", Body: map[string]any{"doseId": doseID, "helped": "maybe", "timeToReliefMinutes": 2000}}).Status)
}

func TestSanitizeNotes(t *testing.T) {
	s := func(v string) *string { return &v }
	require.Nil(t, svc.SanitizeNotes(nil))
	require.Nil(t, svc.SanitizeNotes(s("  \t\n ")))
	require.Equal(t, "a b c", *svc.SanitizeNotes(s(" a\x00b\u0007\n c ")))
	long := ""
	for range 600 {
		long += "x"
	}
	require.Len(t, *svc.SanitizeNotes(&long), 500)
}

var _ = fmt.Sprint

func TestUserMedicationCatalog(t *testing.T) {
	e := newEnv(t)
	e.Exec(`INSERT INTO medications_catalog (id, canonical_name, canonical_name_lc, search_text) VALUES
		('aaaaaaaa-0000-4000-8000-000000000001', 'Ibuprofen', 'ibuprofen', 'ibuprofen nurofen'),
		('aaaaaaaa-0000-4000-8000-000000000002', 'Ібупрофен', 'ібупрофен', 'ібупрофен нурофен'),
		('aaaaaaaa-0000-4000-8000-000000000003', 'Sumatriptan', 'sumatriptan', 'sumatriptan imigran')`)

	res := e.Do(apitest.Request{Method: "POST", Path: "/api/user-medications", User: "u", Body: map[string]any{"catalogMedicationId": "aaaaaaaa-0000-4000-8000-000000000003", "isPinned": true, "medicationClass": "triptan"}})
	require.Equal(t, 201, res.Status, string(res.Body))
	suma := res.Map(t)["userMedicationId"]
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/user-medications", User: "u", Body: map[string]any{"catalogMedicationId": "aaaaaaaa-0000-4000-8000-000000000003"}})
	require.Equal(t, 200, res.Status)
	require.Equal(t, suma, res.Map(t)["userMedicationId"])
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/user-medications", User: "u", Body: map[string]any{"customName": "  My   Mix "}})
	require.Equal(t, 201, res.Status)
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/user-medications", User: "u", Body: map[string]any{}})
	require.Equal(t, 500, res.Status, "no ZodError branch: the message is the 500 body")
	require.Contains(t, string(res.Body), "catalogMedicationId or customName is required")

	list := e.Do(apitest.Request{Path: "/api/user-medications", User: "u"}).Map(t)
	require.Len(t, list["pinned"], 1)
	require.Equal(t, "Sumatriptan", list["pinned"].([]any)[0].(map[string]any)["label"])
	require.Len(t, list["all"], 2)
	require.Equal(t, []any{}, list["recentlyUsed"])
	require.Equal(t, `{"pinned":[],"recentlyUsed":[],"all":[]}`, string(e.Do(apitest.Request{Path: "/api/user-medications", User: "other"}).Body))

	require.Equal(t, `{"success":true}`, string(e.Do(apitest.Request{Method: "PATCH", Path: fmt.Sprintf("/api/user-medications/%v", suma), User: "u", Body: map[string]any{"defaultDose": " 50 ", "isPinned": false}}).Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM user_medications WHERE id = $1 AND default_dose = '50' AND NOT is_pinned`, suma))
	require.Equal(t, 404, e.Do(apitest.Request{Method: "PATCH", Path: fmt.Sprintf("/api/user-medications/%v", suma), User: "other", Body: map[string]any{"isPinned": true}}).Status)
	require.Equal(t, 500, e.Do(apitest.Request{Method: "PATCH", Path: fmt.Sprintf("/api/user-medications/%v", suma), User: "u", Body: map[string]any{}}).Status)

	// Search: user meds first, owned catalog entries de-duplicated, script by language.
	res = e.Do(apitest.Request{Path: "/api/medications/search?q=suma", User: "u"})
	results := res.Map(t)["results"].([]any)
	require.Len(t, results, 1)
	require.Equal(t, "user", results[0].(map[string]any)["kind"])
	res = e.Do(apitest.Request{Path: "/api/medications/search?q=ibu", User: "u"})
	results = res.Map(t)["results"].([]any)
	require.Len(t, results, 1)
	require.Equal(t, "Ibuprofen", results[0].(map[string]any)["label"])
	e.Exec(`UPDATE "user" SET preferred_language = 'uk' WHERE id = 'u'`)
	results = e.Do(apitest.Request{Path: "/api/medications/search?q=" + "%D1%96%D0%B1%D1%83", User: "u"}).Map(t)["results"].([]any)
	require.Len(t, results, 1)
	require.Equal(t, "Ібупрофен", results[0].(map[string]any)["label"])
	require.Equal(t, `{"results":[]}`, string(e.Do(apitest.Request{Path: "/api/medications/search?q=%20%20", User: "u"}).Body))
	res = e.Do(apitest.Request{Path: "/api/medications/search?q=x", User: "nobody"})
	require.Equal(t, `{"error":"Health data consent required","code":"CONSENT_REQUIRED","message":"You must provide explicit consent for health data processing before searching meds."}`, string(res.Body))
}
