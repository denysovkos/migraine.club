package preventives_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/preventives"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/testdb/fixture"
)

// now is 2025-03-01 12:00 in Europe/Berlin (the default for "UTC" users).
var now = time.Date(2025, 3, 1, 11, 0, 0, 0, time.UTC)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		preventives.Mount(r, d)
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

func create(t *testing.T, e *apitest.Env, user string, body map[string]any) string {
	t.Helper()
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/preventives", User: user, Body: body})
	require.Equal(t, 201, res.Status, string(res.Body))
	return res.Map(t)["id"].(string)
}

func TestAuthAndConsent(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/api/preventives", "/api/preventives/due", "/api/preventives/00000000-0000-4000-8000-000000000000/summary"} {
		require.Equal(t, `{"error":"Unauthorized"}`, string(e.Do(apitest.Request{Path: p}).Body))
		res := e.Do(apitest.Request{Path: p, User: "noconsent"})
		require.Equal(t, 403, res.Status)
		require.Equal(t, `{"error":"Health data consent required","code":"CONSENT_REQUIRED"}`, string(res.Body))
	}
}

func TestCreateListDetailUpdateDelete(t *testing.T) {
	e := newEnv(t)
	id := create(t, e, "u", map[string]any{
		"name": "  Topiramate ", "kind": "oral", "doseText": " 25 mg ", "scheduleType": "custom_weekdays",
		"schedulePayload": []any{5, 1, 3}, "startDate": "2025-01-15", "reminderTimes": []any{"20:30", "08:00", "08:00"},
		"remindersEnabled": true,
	})
	create(t, e, "u", map[string]any{"name": "topiramate", "kind": "oral", "scheduleType": "daily", "startDate": "2025-02-01"})
	create(t, e, "other", map[string]any{"name": "Other", "kind": "oral", "scheduleType": "daily", "startDate": "2025-02-01"})

	plans := e.Do(apitest.Request{Path: "/api/preventives", User: "u"}).Map(t)["plans"].([]any)
	require.Len(t, plans, 2)
	first := plans[1].(map[string]any)
	require.Equal(t, "Topiramate", first["name"])
	require.Equal(t, "25 mg", first["doseText"])
	require.Equal(t, "Mon, Wed, Fri", first["scheduleLabel"])
	require.Equal(t, []any{"08:00", "20:30"}, first["reminderTimes"])
	require.Equal(t, true, first["isDuplicateName"])
	require.Equal(t, "2025-01-15", first["startDate"])
	require.Nil(t, first["pausedAt"])

	detail := e.Do(apitest.Request{Path: "/api/preventives/" + id, User: "u"})
	require.Equal(t, `{"plan":{"id":"`+id+`","name":"Topiramate","kind":"oral","doseText":"25 mg","scheduleType":"custom_weekdays","schedulePayload":[5,1,3],"startDate":"2025-01-15","status":"active"}}`, string(detail.Body))
	require.Equal(t, `{"error":"Not found"}`, string(e.Do(apitest.Request{Path: "/api/preventives/" + id, User: "other"}).Body))

	res := e.Do(apitest.Request{Method: "PATCH", Path: "/api/preventives/" + id, User: "u", Body: map[string]any{"doseText": nil, "schedulePayload": nil, "scheduleType": "daily"}})
	require.Equal(t, `{"ok":true}`, string(res.Body))
	d := e.Do(apitest.Request{Path: "/api/preventives/" + id, User: "u"}).Map(t)["plan"].(map[string]any)
	require.Nil(t, d["doseText"])
	require.Equal(t, map[string]any{}, d["schedulePayload"])
	require.Equal(t, "Topiramate", d["name"])

	res = e.Do(apitest.Request{Method: "PATCH", Path: "/api/preventives/" + id, User: "other", Body: map[string]any{"name": "x"}})
	require.Equal(t, `{"error":"Preventive plan not found"}`, string(res.Body))
	require.Equal(t, 500, res.Status)

	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "DELETE", Path: "/api/preventives/" + id, User: "other"}).Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM preventive_plan WHERE id = $1`, id))
	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "DELETE", Path: "/api/preventives/" + id, User: "u"}).Body))
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM preventive_plan WHERE id = $1`, id))
}

func TestErrorMessagesMatchNode(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/preventives", User: "u", Raw: "{bad"})
	require.Equal(t, `{"error":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/preventives", User: "u", Body: map[string]any{"name": "X", "kind": "oral", "scheduleType": "daily", "startDate": "2024-13-01"}})
	require.Equal(t, `{"error":"Invalid time value"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/preventives", User: "u", Body: map[string]any{"name": "", "kind": "pill", "scheduleType": "daily", "startDate": "x"}})
	require.Equal(t, 500, res.Status)
	require.Contains(t, res.Map(t)["error"], `"too_small"`)

	res = e.Do(apitest.Request{Method: "PATCH", Path: "/api/preventives/abc", User: "u", Body: map[string]any{}})
	require.Equal(t, `{"error":"Failed query: select \"id\" from \"preventive_plan\" where (\"preventive_plan\".\"user_id\" = $1 and \"preventive_plan\".\"id\" = $2) limit $3\nparams: u,abc,1"}`, string(res.Body))
	res = e.Do(apitest.Request{Path: "/api/preventives/abc/summary", User: "u"})
	require.Contains(t, string(res.Body), `"error":"Failed query: select \"id\", \"name\"`)

	for _, req := range []apitest.Request{
		{Path: "/api/preventives/abc", User: "u"},
		{Method: "POST", Path: "/api/preventives/abc/pause", User: "u"},
		{Method: "POST", Path: "/api/preventives/00000000-0000-4000-8000-000000000000/resume", User: "u"},
		{Method: "POST", Path: "/api/preventives/abc/stop", User: "u", Raw: "{"},
		{Method: "DELETE", Path: "/api/preventives/abc", User: "u"},
	} {
		res := e.Do(req)
		require.Equal(t, 500, res.Status, req.Path)
		require.Empty(t, res.Body, req.Path)
	}

	fk := e.Do(apitest.Request{Method: "POST", Path: "/api/preventives", User: "u", Body: map[string]any{
		"name": "X", "kind": "oral", "scheduleType": "daily", "startDate": "2024-01-01",
		"catalogMedicationId": "00000000-0000-4000-8000-000000000000", "schedulePayload": map[string]any{"n": 2}, "reminderTimes": []any{"08:00"},
	}})
	require.Equal(t, `{"error":"Failed query: insert into \"preventive_plan\" (\"id\", \"user_id\", \"catalog_medication_id\", \"name\", \"kind\", \"dose_text\", \"schedule_type\", \"schedule_payload\", \"start_date\", \"reminder_times\", \"reminders_enabled\", \"status\", \"paused_at\", \"stopped_at\", \"stop_reason\", \"stop_reason_note\", \"updated_at\", \"created_at\") values (default, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, default, default) returning \"id\"\nparams: u,00000000-0000-4000-8000-000000000000,X,oral,,daily,{\"n\":2},2024-01-01T00:00:00.000Z,[\"08:00\"],false,active,,,,"}`, string(fk.Body))
}

func TestStatusChanges(t *testing.T) {
	e := newEnv(t)
	id := create(t, e, "u", map[string]any{"name": "A", "kind": "oral", "scheduleType": "daily", "startDate": "2025-01-01"})
	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/preventives/" + id + "/pause", User: "u"}).Body))
	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/preventives/" + id + "/pause", User: "u"}).Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM preventive_plan WHERE id = $1 AND status = 'paused' AND paused_at IS NOT NULL`, id))
	e.Do(apitest.Request{Method: "POST", Path: "/api/preventives/" + id + "/resume", User: "u"})
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/preventives/" + id + "/stop", User: "u", Body: map[string]any{"reason": "cost", "reasonNote": " too pricey "}})
	require.Equal(t, `{"ok":true}`, string(res.Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM preventive_plan WHERE id = $1 AND status = 'stopped' AND paused_at IS NULL AND stop_reason = 'cost' AND stop_reason_note = 'too pricey'`, id))
	require.Equal(t, 3, e.Count(`SELECT count(*) FROM preventive_status_change WHERE plan_id = $1`, id))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/preventives/intake", User: "u", Body: map[string]any{"planId": id, "localDate": "2025-03-01", "state": "taken"}})
	require.Equal(t, `{"error":"Preventive plan is stopped"}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/preventives/" + id + "/stop", User: "other", Body: map[string]any{"reason": "cost"}})
	require.Equal(t, 500, res.Status)
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM preventive_plan WHERE id = $1 AND status = 'stopped'`, id))
}

func TestIntakeDueAndInsight(t *testing.T) {
	e := newEnv(t)
	daily := create(t, e, "u", map[string]any{"name": "Daily", "kind": "oral", "scheduleType": "daily", "startDate": "2025-01-01"})
	inj := create(t, e, "u", map[string]any{"name": "Shot", "kind": "injection", "scheduleType": "every_n_weeks", "schedulePayload": map[string]any{"n": 4}, "startDate": "2025-01-04"})
	weekdays := create(t, e, "u", map[string]any{"name": "Wk", "kind": "oral", "scheduleType": "weekdays", "startDate": "2025-01-01"})
	_ = weekdays

	post := func(body map[string]any) string {
		return string(e.Do(apitest.Request{Method: "POST", Path: "/api/preventives/intake", User: "u", Body: body}).Body)
	}
	require.Equal(t, `{"ok":true}`, post(map[string]any{"planId": daily, "localDate": "2025-03-01", "state": "missed"}))
	require.Equal(t, `{"ok":true}`, post(map[string]any{"planId": daily, "localDate": "2025-03-01", "state": "taken", "note": " ok "}))
	require.Equal(t, `{"ok":true}`, post(map[string]any{"planId": daily, "localDate": "2025-02-28", "state": "missed"}))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM preventive_intake_event WHERE plan_id = $1 AND local_date = '2025-03-01' AND state = 'taken' AND note = 'ok' AND taken_at IS NOT NULL`, daily))
	require.Equal(t, `{"ok":true}`, post(map[string]any{"planId": daily, "localDate": "2025-02-30", "state": "taken"}))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM preventive_intake_event WHERE plan_id = $1 AND local_date = '2025-03-02'`, daily))
	require.Equal(t, `{"error":"Preventive plan not found"}`, string(e.Do(apitest.Request{Method: "POST", Path: "/api/preventives/intake", User: "other", Body: map[string]any{"planId": daily, "localDate": "2025-03-01", "state": "taken"}}).Body))

	due := e.Do(apitest.Request{Path: "/api/preventives/due", User: "u"}).Map(t)
	require.Equal(t, "Europe/Berlin", due["timezone"])
	require.Equal(t, "2025-03-01", due["todayLocalDate"])
	require.Equal(t, []any{
		map[string]any{"id": daily, "name": "Daily", "kind": "oral", "scheduleLabel": "Daily", "isOverdue": false, "state": "taken"},
		map[string]any{"id": inj, "name": "Shot", "kind": "injection", "scheduleLabel": "Every 4 weeks", "isOverdue": false, "state": nil},
	}, due["due"])
	require.Len(t, due["notDue"], 1) // Saturday: weekdays plan is not due
	require.Equal(t, map[string]any{"adherencePct": 0.5, "migraineDays": float64(0), "from": "2025-02-23", "to": "2025-03-01"}, due["insight"])

	due = e.Do(apitest.Request{Path: "/api/preventives/due?localDate=2025-03-03", User: "u"}).Map(t)
	require.Equal(t, "2025-03-03", due["todayLocalDate"])
	require.Len(t, due["due"], 3)
	require.Equal(t, 500, e.Do(apitest.Request{Path: "/api/preventives/due?localDate=nope", User: "u"}).Status)

	empty := e.Do(apitest.Request{Path: "/api/preventives/due?localDate=nope", User: "other"})
	require.Equal(t, `{"timezone":"Europe/Berlin","todayLocalDate":null,"due":[],"notDue":[],"hasActivePlans":false,"insight":null}`, string(empty.Body))
}

func TestSummaryAndCheckIn(t *testing.T) {
	e := newEnv(t)
	id := create(t, e, "u", map[string]any{"name": "Daily", "kind": "oral", "scheduleType": "daily", "startDate": "2025-01-15", "reminderTimes": []any{"08:00"}})
	e.Exec(`INSERT INTO daily_diary_entry (user_id, local_date, timezone, day_type) VALUES
		('u', '2025-01-01', 'UTC', 'migraine_day'), ('u', '2025-01-02', 'UTC', 'migraine_day'), ('u', '2025-02-10', 'UTC', 'migraine_day'),
		('other', '2025-02-11', 'UTC', 'migraine_day')`)
	e.Exec(`INSERT INTO preventive_intake_event (user_id, plan_id, local_date, state) VALUES ('u', $1, '2025-02-27', 'taken'), ('u', $1, '2025-02-28', 'missed')`, id)

	s := e.Do(apitest.Request{Path: "/api/preventives/" + id + "/summary", User: "u"}).Map(t)
	require.Equal(t, "Europe/Berlin", s["timezone"])
	plan := s["plan"].(map[string]any)
	require.Equal(t, "Daily", plan["scheduleLabel"])
	require.Equal(t, []any{"08:00"}, plan["reminderTimes"])
	base := s["baseline"].(map[string]any)
	require.Equal(t, "2024-12-18", base["from"])
	require.Equal(t, float64(2), base["mmd"])
	ev := s["evaluation"].(map[string]any)
	require.Equal(t, "2025-01-29", ev["from"])
	require.Equal(t, "2025-02-25", ev["to"])
	require.Equal(t, float64(1), ev["mmd"])
	require.Equal(t, -0.5, ev["percentChangeMmd"])
	require.Equal(t, "NOT_ENOUGH_DATA", ev["responder50"])
	require.Equal(t, float64(27), ev["missingDaysNeeded"])
	require.Equal(t, "2025-03-01", s["evaluationLong"].(map[string]any)["to"])
	last7 := s["adherence"].(map[string]any)["last7"].(map[string]any)
	require.Equal(t, map[string]any{"dueDays": float64(7), "taken": float64(1), "missed": float64(1), "unsure": float64(0), "coverage": 2.0 / 7}, last7)
	weeks := s["timelineWeeks"].([]any)
	require.Len(t, weeks, 7)
	require.Equal(t, map[string]any{"weekStart": "2025-01-13", "migraineDays": float64(0), "adherence": nil}, weeks[0])

	res := e.Do(apitest.Request{Path: "/api/preventives/" + id + "/summary", User: "other"})
	require.Equal(t, `{"error":"Preventive plan not found"}`, string(res.Body))

	path := "/api/preventives/" + id + "/weekly-checkin"
	body := map[string]any{"weekStartLocalDate": "2025-02-24", "sideEffects": "mild", "stillTaking": "yes", "planId": "ignored"}
	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "POST", Path: path, User: "u", Body: body}).Body))
	body["sideEffects"] = "severe"
	require.Equal(t, `{"ok":true}`, string(e.Do(apitest.Request{Method: "POST", Path: path, User: "u", Body: body}).Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM preventive_weekly_check_in WHERE plan_id = $1 AND side_effects = 'severe'`, id))
	require.Equal(t, `{"error":"Preventive plan not found"}`, string(e.Do(apitest.Request{Method: "POST", Path: path, User: "other", Body: body}).Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/preventives/abc/weekly-checkin", User: "u", Body: body})
	require.Equal(t, 500, res.Status)
	require.Contains(t, res.Map(t)["error"], `"path": [`)
}
