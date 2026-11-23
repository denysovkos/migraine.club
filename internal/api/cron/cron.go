// Package cron serves /api/cron/*: the shared createCronRoute plumbing and
// the jobs behind it.
package cron

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/cronjob"
	"github.com/denysovkos/migraine.club/internal/httpx"
)

// defaultBudget is DEFAULT_CRON_BUDGET_MS; leaseGrace is LEASE_GRACE_MS.
const (
	defaultBudget = 50 * time.Second
	leaseGrace    = 30 * time.Second
)

// Job is CronJobConfig.
type Job struct {
	Name, Description string
	// Disabled is `enabled: false`.
	Disabled bool
	Budget   time.Duration
	RunOnGet bool
	Run      func(ctx context.Context, d *cronjob.Deadline, runID string) (*httpx.Object, error)
}

type route struct {
	d   *app.Deps
	job Job
}

func (rt route) budget() time.Duration {
	if rt.job.Budget > 0 {
		return rt.job.Budget
	}
	return defaultBudget
}

// authorized is isAuthorized: x-cron-secret, else the bearer token, compared
// in constant time.
func (rt route) authorized(w http.ResponseWriter, r *http.Request) bool {
	expected := rt.d.Cfg.CronSecret
	if expected == "" {
		rt.d.Log.Warn("CRON_SECRET not configured")
		httpx.JSON(w, http.StatusServiceUnavailable, httpx.O("error", "Cron not configured", "configured", false))
		return false
	}
	provided := ""
	if v, ok := r.Header["X-Cron-Secret"]; ok {
		provided = strings.Join(v, ", ")
	} else if v, ok := r.Header["Authorization"]; ok {
		provided = strings.TrimPrefix(strings.Join(v, ", "), "Bearer ")
	}
	if len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		rt.d.Log.Warn("Invalid cron secret provided")
		httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
		return false
	}
	return true
}

func (rt route) execute(w http.ResponseWriter, r *http.Request) {
	job := rt.job
	if job.Disabled {
		httpx.JSON(w, http.StatusOK, httpx.O("ok", true, "job", job.Name, "skipped", true, "reason", "disabled"))
		return
	}
	lease, err := cronjob.Acquire(r.Context(), rt.d.Q, rt.d.Log, job.Name, rt.budget()+leaseGrace, rt.d.Clock())
	if err != nil {
		rt.d.Log.Error("Cron lease failed", "error", err, "job", job.Name)
		httpx.Unhandled(w)
		return
	}
	if lease == nil {
		rt.d.Log.Info("Cron run skipped: previous run still holds the lease", "job", job.Name)
		httpx.JSON(w, http.StatusOK, httpx.O("ok", true, "job", job.Name, "skipped", true, "reason", "already_running"))
		return
	}
	defer lease.Release(r.Context())
	deadline := cronjob.NewDeadline(rt.budget(), rt.d.Clock)
	rt.d.Log.Info("Cron job started", "job", job.Name, "runId", lease.RunID, "budgetMs", rt.budget().Milliseconds())
	summary, err := job.Run(r.Context(), deadline, lease.RunID)
	duration := deadline.ElapsedMs()
	if err != nil {
		rt.d.Log.Error("Cron job failed", "error", err, "job", job.Name, "runId", lease.RunID, "duration", duration)
		httpx.JSON(w, http.StatusInternalServerError, httpx.O("ok", false, "job", job.Name, "error", "Failed to run "+job.Name,
			"message", err.Error(), "duration", duration))
		return
	}
	rt.d.Log.Info("Cron job completed", "job", job.Name, "runId", lease.RunID, "duration", duration)
	out := httpx.O("ok", true, "job", job.Name, "runId", lease.RunID, "duration", duration)
	if summary != nil {
		for _, k := range summary.Keys() {
			v, _ := summary.Get(k)
			out.Set(k, v)
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (rt route) post(w http.ResponseWriter, r *http.Request) {
	if rt.authorized(w, r) {
		rt.execute(w, r)
	}
}

func (rt route) get(w http.ResponseWriter, r *http.Request) {
	if !rt.authorized(w, r) {
		return
	}
	if rt.job.RunOnGet || r.URL.Query().Get("run") == "1" {
		rt.execute(w, r)
		return
	}
	getDoc := "Health check (add ?run=1 to run the job)"
	if rt.job.RunOnGet {
		getDoc = "Run the job"
	}
	httpx.JSON(w, http.StatusOK, httpx.O("ok", true, "job", rt.job.Name, "configured", true, "enabled", !rt.job.Disabled,
		"budgetMs", rt.budget().Milliseconds(), "description", rt.job.Description,
		"endpoints", httpx.O("POST", "Run the job", "GET", getDoc)))
}

// mount registers one cron route.
func mount(r chi.Router, d *app.Deps, job Job) {
	rt := route{d: d, job: job}
	r.Post("/api/cron/"+job.Name, rt.post)
	r.Get("/api/cron/"+job.Name, rt.get)
}
