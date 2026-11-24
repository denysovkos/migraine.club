package cron

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/cronjob"
	"github.com/denysovkos/migraine.club/internal/httpx"
)

const secret = "super-secret-value"

func env(t *testing.T, cfgSecret string, job Job) *apitest.Env {
	return apitest.New(t, func(d *app.Deps) http.Handler {
		d.Cfg.CronSecret = cfgSecret
		r := chi.NewRouter()
		mount(r, d, job)
		return r
	})
}

func okJob(runs *int) Job {
	return Job{Name: "test-job", Description: "Test job", Run: func(context.Context, *cronjob.Deadline, string) (*httpx.Object, error) {
		*runs++
		return httpx.O("processed", 3), nil
	}}
}

func TestCronRoute(t *testing.T) {
	runs := 0
	e := env(t, "", okJob(&runs))
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/cron/test-job", Headers: map[string]string{"x-cron-secret": secret}})
	require.Equal(t, `{"error":"Cron not configured","configured":false}`, string(res.Body))
	require.Equal(t, 503, res.Status)

	e = env(t, secret, okJob(&runs))
	for _, h := range []map[string]string{{"x-cron-secret": "super-secret-valuX"}, {"x-cron-secret": "short"}, {"authorization": "Basic " + secret}} {
		require.Equal(t, 401, e.Do(apitest.Request{Method: "POST", Path: "/api/cron/test-job", Headers: h}).Status)
	}
	require.Equal(t, 0, runs)

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/cron/test-job", Headers: map[string]string{"authorization": "Bearer " + secret}})
	require.Equal(t, 200, res.Status)
	m := res.Map(t)
	require.Equal(t, true, m["ok"])
	require.Equal(t, 3.0, m["processed"])
	require.NotEmpty(t, m["runId"])
	require.Equal(t, 1, runs)

	res = e.Do(apitest.Request{Path: "/api/cron/test-job", Headers: map[string]string{"x-cron-secret": secret}})
	require.Equal(t, true, res.Map(t)["configured"])
	require.Equal(t, 1, runs, "GET is a health check")
	e.Do(apitest.Request{Path: "/api/cron/test-job?run=1", Headers: map[string]string{"x-cron-secret": secret}})
	require.Equal(t, 2, runs)

	// A live lease from another run makes this one skip.
	e.Exec(`UPDATE cron_run_lock SET expires_at = now() + interval '1 hour'`)
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/cron/test-job", Headers: map[string]string{"x-cron-secret": secret}})
	require.Equal(t, `{"ok":true,"job":"test-job","skipped":true,"reason":"already_running"}`, string(res.Body))
}

func TestCronDisabledAndFailing(t *testing.T) {
	runs := 0
	j := okJob(&runs)
	j.Disabled = true
	e := env(t, secret, j)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/cron/test-job", Headers: map[string]string{"x-cron-secret": secret}})
	require.Equal(t, `{"ok":true,"job":"test-job","skipped":true,"reason":"disabled"}`, string(res.Body))

	failing := Job{Name: "test-job", RunOnGet: true, Run: func(context.Context, *cronjob.Deadline, string) (*httpx.Object, error) {
		return nil, errors.New("boom")
	}}
	e = env(t, secret, failing)
	res = e.Do(apitest.Request{Path: "/api/cron/test-job", Headers: map[string]string{"x-cron-secret": secret}})
	require.Equal(t, 500, res.Status)
	require.Equal(t, "boom", res.Map(t)["message"])
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM cron_run_lock WHERE expires_at <= now()`), "the lease is released")
}
