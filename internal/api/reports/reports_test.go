package reports_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/reports"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

// now: 2026-03-20 12:00 UTC (13:00 in Berlin, the reports' fixed zone).
var now = time.Date(2026, 3, 20, 12, 0, 0, 0, time.UTC)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		reports.Mount(r, d)
		return r
	})
	e.Deps.Now = func() time.Time { return now }
	for _, u := range []string{"u", "other", "noconsent"} {
		fixture.User(t, e.Deps.Pool, u)
	}
	fixture.Consents(t, e.Deps.Pool, "u")
	fixture.Consents(t, e.Deps.Pool, "other")
	return e
}

func TestMohStatus(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, 403, e.Do(apitest.Request{Path: "/api/moh-status", User: "noconsent"}).Status)
	med := fixture.Medication(t, e.Deps.Pool, "u", "Suma") // triptan
	// 9 triptan days this month: 9 >= 0.8*10, so "approaching"; one dose in Feb.
	e.Exec(`INSERT INTO acute_doses (user_id, medication_id, taken_at)
		SELECT 'u', $1::uuid, '2026-03-01T10:00:00Z'::timestamptz + (n * interval '1 day') FROM generate_series(0, 8) n
		UNION ALL SELECT 'u', $1::uuid, '2026-02-25T10:00:00Z'`, med)
	m := e.Do(apitest.Request{Path: "/api/moh-status", User: "u"}).Map(t)
	require.Equal(t, "2026-03-20T13:00:00.000+01:00", m["asOf"])
	triptan := m["perClass"].([]any)[0].(map[string]any)
	require.Equal(t, map[string]any{"medicationClass": "triptan", "rolling30DaysUsed": float64(10), "calendarMonthDaysUsed": float64(9),
		"threshold": float64(10), "status": "exceeded"}, triptan)
	require.Equal(t, "exceeded", m["status"])
	m = e.Do(apitest.Request{Path: "/api/moh-status?windowDays=7", User: "u"}).Map(t)
	require.Equal(t, float64(0), m["perClass"].([]any)[0].(map[string]any)["rolling30DaysUsed"])
	require.Equal(t, "approaching", m["perClass"].([]any)[0].(map[string]any)["status"])
	require.Equal(t, 400, e.Do(apitest.Request{Path: "/api/moh-status?windowDays=61", User: "u"}).Status)
	require.Equal(t, "ok", e.Do(apitest.Request{Path: "/api/moh-status", User: "other"}).Map(t)["status"])
}

func TestAcuteReport(t *testing.T) {
	e := newEnv(t)
	med := fixture.Medication(t, e.Deps.Pool, "u", "Suma")
	var dose string
	require.NoError(t, e.Deps.Pool.QueryRow(t.Context(), `INSERT INTO acute_doses (user_id, medication_id, taken_at) VALUES ('u', $1, '2026-03-19T08:00:00Z') RETURNING id`, med).Scan(&dose))
	e.Exec(`INSERT INTO acute_doses (user_id, medication_id, taken_at) VALUES ('u', $1, '2026-03-19T20:00:00Z'), ('u', $1, '2026-03-10T08:00:00Z')`, med)
	e.Exec(`INSERT INTO dose_outcomes (user_id, dose_id, helped, time_to_relief_minutes) VALUES ('u', $1, 'yes', 45)`, dose)
	m := e.Do(apitest.Request{Path: "/api/acute-meds-report", User: "u"}).Map(t)
	require.Equal(t, map[string]any{"from": "2026-02-19", "to": "2026-03-20"}, m["range"])
	got := m["medications"].([]any)[0].(map[string]any)
	require.Equal(t, "Suma", got["medicationLabel"])
	require.Equal(t, float64(2), got["usageDays"])
	require.Equal(t, float64(3), got["doses"])
	require.Equal(t, float64(1), got["successRate"])
	require.Equal(t, float64(45), got["medianTimeToReliefMinutes"])
	require.Equal(t, 1.0/3, got["needingSecondDosePct"])
	month := e.Do(apitest.Request{Path: "/api/acute-meds-report?mode=calendarMonth", User: "u"}).Map(t)
	require.Equal(t, map[string]any{"from": "2026-03-01", "to": "2026-03-31"}, month["range"])
	require.Empty(t, e.Do(apitest.Request{Path: "/api/acute-meds-report", User: "other"}).Map(t)["medications"])
}

func TestAppointmentPreps(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/appointment-preps", User: "u", Body: map[string]any{
		"appointmentDate": "2026-04-31", "visitLabel": "  ", "clinicianName": " Dr. X ", "topConcerns": []any{" a "}, "compareWindowDays": "30"}})
	require.Equal(t, 201, res.Status, string(res.Body))
	id := res.Map(t)["id"].(string)
	d := e.Do(apitest.Request{Path: "/api/appointment-preps/" + id, User: "u"}).Map(t)["draft"].(map[string]any)
	require.Equal(t, "2026-05-01", d["appointmentDate"]) // V8 date rollover
	require.Nil(t, d["visitLabel"])
	require.Equal(t, "Dr. X", d["clinicianName"])
	require.Equal(t, []any{"a"}, d["topConcerns"])
	snap := d["generatedSnapshot"].(map[string]any)
	require.Equal(t, float64(30), snap["compareWindowDays"])
	require.Equal(t, []any{"coverage_summary", "attack_summary"}, snap["whatChangedKeys"])

	require.Equal(t, `{"error":"Not found"}`, string(e.Do(apitest.Request{Path: "/api/appointment-preps/" + id, User: "other"}).Body))
	require.Equal(t, `{"error":"Not found"}`, string(e.Do(apitest.Request{Method: "DELETE", Path: "/api/appointment-preps/" + id, User: "other"}).Body))
	bad := e.Do(apitest.Request{Method: "POST", Path: "/api/appointment-preps", User: "u", Body: map[string]any{"appointmentDate": "soon"}})
	require.Equal(t, 400, bad.Status)
	require.Contains(t, string(bad.Body), `"fieldErrors":{"appointmentDate":`)
	require.Equal(t, `{"error":"Invalid time value"}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/appointment-preps", User: "u", Body: map[string]any{"appointmentDate": "2026-13-01"}}).Body))

	p := e.Do(apitest.Request{Method: "PATCH", Path: "/api/appointment-preps/" + id, User: "u", Body: map[string]any{"clinicianName": nil, "personalNotes": " n "}}).Map(t)["draft"].(map[string]any)
	require.Nil(t, p["clinicianName"])
	require.Equal(t, "n", p["personalNotes"])
	require.Equal(t, []any{"a"}, p["topConcerns"])
	badID := e.Do(apitest.Request{Method: "PATCH", Path: "/api/appointment-preps/abc", User: "u", Body: map[string]any{}})
	require.Equal(t, 500, badID.Status)
	require.Contains(t, badID.Map(t)["error"], `Failed query: select "id", "appointment_date"`)
	require.Len(t, e.Do(apitest.Request{Path: "/api/appointment-preps", User: "u"}).Map(t)["drafts"], 1)
	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "DELETE", Path: "/api/appointment-preps/" + id, User: "u"}).Body))
	require.Empty(t, e.Do(apitest.Request{Path: "/api/appointment-preps", User: "u"}).Map(t)["drafts"])
}

func preview(e *apitest.Env, cfg string) apitest.Response {
	return e.Do(apitest.Request{Path: "/api/reports/clinician/preview?config=" + url.QueryEscape(cfg), User: "u"})
}

func TestPreview(t *testing.T) {
	e := newEnv(t)
	e.Exec(`UPDATE "user" SET display_name = 'Ann <b>' WHERE id = 'u'`)
	e.Exec(`INSERT INTO episode (user_id, attack_type, start_time, end_time, intensity, pain_location, pain_type, symptoms)
		VALUES ('u', 'migraine', '2026-03-10T08:00:00Z', '2026-03-10T09:15:00Z', 4, 'LEFT', 'PRESSURE', '["nausea", "{x}"]')`)
	res := preview(e, `{"template":"full"}`)
	require.Equal(t, 200, res.Status)
	require.Equal(t, "text/html; charset=utf-8", res.Header.Get("Content-Type"))
	html := string(res.Body)
	require.Contains(t, html, "<p>Patient: Ann b</p>") // sanitized, then escaped
	require.Contains(t, html, "<td>2026-03-10</td>")
	require.Contains(t, html, "<td>1.3</td>") // 1.25h toFixed(1)
	require.Contains(t, html, "<td>nausea, x</td>")
	require.NotContains(t, html, "Cycle &amp; hormones")
	require.True(t, strings.HasPrefix(html, "\n<!doctype html>"))

	require.Equal(t, `{"error":"Invalid config JSON"}`, string(preview(e, "{bad").Body))
	require.Equal(t, 400, preview(e, `{"rangePreset":"custom"}`).Status)
	require.Equal(t, `{"error":"Failed to generate preview"}`, string(preview(e, `{"rangePreset":"custom","from":"2026-02-30","to":"2026-03-01"}`).Body))
	require.Equal(t, 401, e.Do(apitest.Request{Path: "/api/reports/clinician/preview"}).Status)
}
