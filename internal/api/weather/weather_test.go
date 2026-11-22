package weather_test

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/weather"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
)

func newEnv(t *testing.T) *apitest.Env {
	return apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		weather.Mount(r, d)
		return r
	})
}

func TestRoutesRequireAuth(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/api/space-weather/kp", "/api/weather-pain-index/current", "/api/weather-pain-index/forecast", "/api/weather-pain-index/history", "/api/user/weather-settings"} {
		require.Equal(t, 401, e.Do(apitest.Request{Path: p}).Status, p)
	}
	require.Equal(t, 401, e.Do(apitest.Request{Method: "PUT", Path: "/api/user/weather-settings", Body: map[string]any{}}).Status)
}

func TestWeatherSettings(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Path: "/api/user/weather-settings", User: "u"})
	require.Equal(t, 404, res.Status)
	require.Equal(t, `{"error":"Weather settings not configured","code":"SETTINGS_NOT_FOUND"}`, string(res.Body))

	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/user/weather-settings", User: "u", Body: map[string]any{"lat": 52.52, "lon": 13.4}})
	require.Equal(t, 200, res.Status)
	require.Equal(t, `{"lat":52.52,"lon":13.4,"locationLabel":null,"timezone":"UTC","units":"metric"}`, string(res.Body))

	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/user/weather-settings", User: "u",
		Body: map[string]any{"lat": 48.85, "lon": 2.35, "locationLabel": "Paris", "timezone": "Europe/Paris", "units": "imperial"}})
	require.Equal(t, `{"lat":48.85,"lon":2.35,"locationLabel":"Paris","timezone":"Europe/Paris","units":"imperial"}`, string(res.Body))
	require.Equal(t, `{"lat":48.85,"lon":2.35,"locationLabel":"Paris","timezone":"Europe/Paris","units":"imperial"}`,
		string(e.Do(apitest.Request{Path: "/api/user/weather-settings", User: "u"}).Body))

	// Another user still has none.
	require.Equal(t, 404, e.Do(apitest.Request{Path: "/api/user/weather-settings", User: "other"}).Status)

	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/user/weather-settings", User: "u", Body: map[string]any{"lat": 91, "lon": "x", "units": "kelvin"}})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"Validation error","details":[{"origin":"number","code":"too_big","maximum":90,"inclusive":true,"path":["lat"],"message":"Too big: expected number to be <=90"},{"expected":"number","code":"invalid_type","path":["lon"],"message":"Invalid input: expected number, received string"},{"code":"invalid_value","values":["metric","imperial"],"path":["units"],"message":"Invalid option: expected one of \"metric\"|\"imperial\""}]}`, string(res.Body))
}

func TestCurrentAndHistory(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Path: "/api/weather-pain-index/current", User: "u"})
	require.Equal(t, 400, res.Status)
	require.Equal(t, `{"error":"Weather settings not configured","code":"SETTINGS_NOT_FOUND","message":"Please configure your location to get weather pain index data."}`, string(res.Body))

	e.Do(apitest.Request{Method: "PUT", Path: "/api/user/weather-settings", User: "u", Body: map[string]any{"lat": 52.52, "lon": 13.4}})
	res = e.Do(apitest.Request{Path: "/api/weather-pain-index/current", User: "u"})
	require.Equal(t, 200, res.Status)
	// Without an API key the weather is neutral and Kp unknown.
	require.Regexp(t, `^\{"timestamp":"[^"]+","score":0.5,"level":"low","components":\{"pressureFactor":0,"humidityFactor":0.25,"tempFactor":0,"windFactor":0,"uviFactor":0,"solarFactor":0\},"weather":\{"deltaPressure":0,"temperatureDeviation":0,"humidity":50,"windSpeed":0,"uvi":0\},"solar":\{"kpIndex":null,"timestampUtc":null,"source":null\}\}$`, string(res.Body))

	res = e.Do(apitest.Request{Path: "/api/weather-pain-index/history?days=7", User: "u"})
	require.Equal(t, 200, res.Status)
	require.Len(t, res.Map(t)["points"], 1)
	require.Equal(t, `{"points":[]}`, string(e.Do(apitest.Request{Path: "/api/weather-pain-index/history", User: "other"}).Body))

	for _, bad := range []string{"0", "91", "abc", "-3"} {
		res = e.Do(apitest.Request{Path: "/api/weather-pain-index/history?days=" + bad, User: "u"})
		require.Equal(t, 400, res.Status, bad)
	}
	// parseInt semantics: "7days" is 7.
	require.Equal(t, 200, e.Do(apitest.Request{Path: "/api/weather-pain-index/history?days=7days", User: "u"}).Status)
}

func TestForecast(t *testing.T) {
	e := newEnv(t)
	require.Equal(t, `{"hasAlert":false,"level":null,"kpIndex":null,"timestampUtc":null,"message":null}`,
		string(e.Do(apitest.Request{Path: "/api/weather-pain-index/forecast", User: "u"}).Body))
	e.Exec(`INSERT INTO solar_activity_snapshot (timestamp_utc, kp_index, source) VALUES ('2026-01-01T00:00:00Z', 4.33, 'noaa'), ('2026-01-01T03:00:00Z', 5, 'noaa'), ('2026-01-02T00:00:00Z', 9, 'gfz')`)
	require.Equal(t, `{"hasAlert":true,"level":"danger","kpIndex":5,"timestampUtc":"2026-01-01T03:00:00.000Z","message":"solar_storm_warning"}`,
		string(e.Do(apitest.Request{Path: "/api/weather-pain-index/forecast", User: "u"}).Body))
}
