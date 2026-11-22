package share

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/httpx"
)

var now = time.Date(2026, 3, 18, 10, 0, 0, 0, time.UTC) // a Wednesday

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		d.Now = func() time.Time { return now }
		r := chi.NewRouter()
		Mount(r, d)
		return r
	})
	e.Exec(`INSERT INTO "user" (id, preferred_language) VALUES ('u1', 'de'), ('u2', 'en')`)
	return e
}

func TestPainLevelAndTruthy(t *testing.T) {
	for in, want := range map[int32]any{0: nil, 1: int32(1), 5: int32(5), 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: nil, -1: nil} {
		require.Equal(t, want, PainLevel(in), in)
	}
	for _, v := range []any{nil, false, 0.0, "", jsNaN()} {
		require.False(t, truthy(v), "%v", v)
	}
	for _, v := range []any{true, 1.0, "0", []any{}, map[string]any{}} {
		require.True(t, truthy(v), "%v", v)
	}
}

func jsNaN() float64 { z := 0.0; return z / z }

func TestWeatherPicksPresentKeys(t *testing.T) {
	b, _ := json.Marshal(weather(json.RawMessage(`{"humidity": 80, "wpiScore": 1, "extra": 2, "kpIndex": null}`)))
	require.Equal(t, `{"wpiScore":1,"kpIndex":null,"humidity":80}`, string(b))
	require.Nil(t, weather(nil))
	require.Nil(t, weather(json.RawMessage(`false`)))
	b, _ = json.Marshal(weather(json.RawMessage(`"text"`)))
	require.Equal(t, `{}`, string(b))
}

func ep(start time.Time, minutes int, intensity any, triggers ...any) sharedEpisode {
	end := start.Add(time.Duration(minutes) * time.Minute)
	return sharedEpisode{obj: httpx.O(), start: start, end: &end, intensity: intensity, triggers: triggers, symptoms: []any{}}
}

func TestCalculateSummary(t *testing.T) {
	time.Local = time.UTC
	empty, _ := json.Marshal(calculateSummary(nil, now))
	require.JSONEq(t, `{"totalEpisodes":0,"episodesThisMonth":0,"averageIntensity":0,"averageDurationMinutes":null,
		"mostCommonTrigger":null,"mostCommonSymptom":null,"mostCommonMedication":null,"weeklyTrend":[]}`, string(empty))

	eps := []sharedEpisode{
		ep(now.Add(-1*time.Hour), 90, int32(4), "stress", "10"),
		ep(now.AddDate(0, 0, -3), 30, int32(1), "stress", "2", "10"),
		ep(now.AddDate(0, -1, 0), 61, nil, "2"),
	}
	eps[0].medLabels = []string{"Rizatriptan"}
	b, _ := json.Marshal(calculateSummary(eps, now))
	var s map[string]any
	require.NoError(t, json.Unmarshal(b, &s))
	require.InDelta(t, 3, s["totalEpisodes"], 0)
	require.InDelta(t, 2, s["episodesThisMonth"], 0)
	require.InDelta(t, 2.5, s["averageIntensity"], 0)
	require.InDelta(t, 60, s["averageDurationMinutes"], 0) // round(181/3)
	// "10" and "2" tie with "stress" on two; array-index keys enumerate first.
	require.Equal(t, "2", s["mostCommonTrigger"])
	require.Nil(t, s["mostCommonSymptom"])
	require.Equal(t, "Rizatriptan", s["mostCommonMedication"])
	trend := s["weeklyTrend"].([]any)
	require.Len(t, trend, 8)
	// Weeks start on the local Sunday; this week holds both March episodes.
	require.Equal(t, map[string]any{"week": "2026-03-15", "count": 2.0, "avgIntensity": 2.5}, trend[7])
	require.Equal(t, "2026-01-25", trend[0].(map[string]any)["week"])
}

func TestCreateListRevoke(t *testing.T) {
	e := newEnv(t)
	for _, m := range []string{"GET", "POST", "DELETE"} {
		require.Equal(t, 401, e.Do(apitest.Request{Method: m, Path: "/api/share", Body: map[string]any{}}).Status, m)
	}

	res := e.Do(apitest.Request{Method: "POST", Path: "/api/share", User: "u1", Body: map[string]any{"label": "Visit",
		"dateRangeStart": "2026-01-01T00:00:00.123456Z"}})
	require.Equal(t, 200, res.Status)
	created := res.Map(t)
	require.Len(t, created["token"], 43)
	require.Equal(t, "2026-03-25T10:00:00.000Z", created["expiresAt"])
	require.Equal(t, "Visit", created["label"])
	require.Nil(t, created["recipientName"])
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM doctor_share_link WHERE date_range_start = '2026-01-01 00:00:00.123'`))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/share", User: "u1", Body: map[string]any{"expiresInDays": 91, "label": nil}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, "Invalid request data", res.Map(t)["error"])
	require.Len(t, res.Map(t)["details"], 2)
	require.Equal(t, 500, e.Do(apitest.Request{Method: "POST", Path: "/api/share", User: "u1", Raw: "{"}).Status)

	e.Exec(`INSERT INTO doctor_share_link (user_id, token, label, expires_at) VALUES ('u2', 'other-users-token-0000000', 'theirs', now())`)
	list := e.Do(apitest.Request{Path: "/api/share", User: "u1"}).JSON(t).([]any)
	require.Len(t, list, 1)
	require.Equal(t, []string{"id", "token", "label", "recipientName", "expiresAt", "accessCount", "lastAccessedAt", "isRevoked", "createdAt"},
		keys(e.Do(apitest.Request{Path: "/api/share", User: "u1"}).Body))

	theirs := e.Do(apitest.Request{Path: "/api/share", User: "u2"}).JSON(t).([]any)[0].(map[string]any)["id"]
	require.Equal(t, 404, e.Do(apitest.Request{Method: "DELETE", Path: "/api/share", User: "u1", Body: map[string]any{"id": theirs}}).Status)
	require.Equal(t, 400, e.Do(apitest.Request{Method: "DELETE", Path: "/api/share", User: "u1", Body: map[string]any{}}).Status)
	require.Equal(t, 500, e.Do(apitest.Request{Method: "DELETE", Path: "/api/share", User: "u1", Body: map[string]any{"id": 5}}).Status)
	require.Equal(t, 500, e.Do(apitest.Request{Method: "DELETE", Path: "/api/share", User: "u1", Raw: "null"}).Status)
	res = e.Do(apitest.Request{Method: "DELETE", Path: "/api/share", User: "u1", Body: map[string]any{"id": created["id"]}})
	require.Equal(t, `{"success":true}`, string(res.Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM doctor_share_link WHERE user_id = 'u1' AND is_revoked`))
	require.Equal(t, 0, e.Count(`SELECT count(*) FROM doctor_share_link WHERE user_id = 'u2' AND is_revoked`))
}

func keys(body []byte) []string {
	var rows []json.RawMessage
	_ = json.Unmarshal(body, &rows)
	dec := json.NewDecoder(bytesReader(rows[0]))
	var out []string
	_, _ = dec.Token()
	for dec.More() {
		k, _ := dec.Token()
		out = append(out, k.(string))
		var skip json.RawMessage
		_ = dec.Decode(&skip)
	}
	return out
}

func TestView(t *testing.T) {
	e := newEnv(t)
	e.Exec(`INSERT INTO doctor_share_link (user_id, token, patient_display_name, expires_at, is_revoked) VALUES
		('u1', 'token-active-0000000000', 'Pat', '2026-03-19', false),
		('u1', 'token-revoked-000000000', NULL, '2026-03-19', true),
		('u1', 'token-expired-000000000', NULL, '2026-03-18 09:59:59', false)`)
	e.Exec(`INSERT INTO episode (user_id, start_time, intensity, pain_location, pain_type, triggers) VALUES
		('u1', '2026-03-17 08:00', 3, 'LEFT', 'PRESSURE', '["stress"]'), ('u2', '2026-03-17 08:00', 3, 'LEFT', 'PRESSURE', '[]')`)

	require.Equal(t, 400, e.Do(apitest.Request{Path: "/api/share/short"}).Status)
	require.Equal(t, 404, e.Do(apitest.Request{Path: "/api/share/token-unknown-000000000"}).Status)
	res := e.Do(apitest.Request{Path: "/api/share/token-revoked-000000000"})
	require.Equal(t, `{"error":"This link has been revoked","code":"REVOKED"}`, string(res.Body))
	res = e.Do(apitest.Request{Path: "/api/share/token-expired-000000000"})
	require.Equal(t, `{"error":"This link has expired","code":"EXPIRED"}`, string(res.Body))

	res = e.Do(apitest.Request{Path: "/api/share/token-active-0000000000"})
	require.Equal(t, 200, res.Status)
	m := res.Map(t)
	require.Equal(t, "Pat", m["patientDisplayName"])
	require.Equal(t, "de", m["patientPreferredLanguage"])
	require.Len(t, m["episodes"], 1, "only the link owner's episodes")
	require.Equal(t, "stress", m["summary"].(map[string]any)["mostCommonTrigger"])
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM doctor_share_link WHERE token = 'token-active-0000000000' AND access_count = 1 AND last_accessed_at IS NOT NULL`))

	e.Exec(`UPDATE episode SET triggers = '{"a": 1}' WHERE user_id = 'u1'`)
	res = e.Do(apitest.Request{Path: "/api/share/token-active-0000000000"})
	require.Equal(t, `{"error":"Failed to fetch data","code":"SERVER_ERROR"}`, string(res.Body))
}

func bytesReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }
