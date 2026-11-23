// Package cronjob is src/libs/cronLock and asyncLimits: leases that keep cron
// runs from stacking, and the wall-clock budget a run must respect.
package cronjob

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
)

// Deadline is asyncLimits' Deadline.
type Deadline struct {
	Start, End time.Time
	now        func() time.Time
}

// NewDeadline starts a budget of d.
func NewDeadline(d time.Duration, now func() time.Time) *Deadline {
	if now == nil {
		now = time.Now
	}
	s := now()
	return &Deadline{Start: s, End: s.Add(d), now: now}
}

// Expired reports whether the budget is spent.
func (d *Deadline) Expired() bool { return d != nil && !d.now().Before(d.End) }

// ElapsedMs is elapsedMs.
func (d *Deadline) ElapsedMs() int64 { return d.now().Sub(d.Start).Milliseconds() }

// RemainingMs is remainingMs.
func (d *Deadline) RemainingMs() int64 { return max(0, d.End.Sub(d.now()).Milliseconds()) }

// Lease is CronLease.
type Lease struct {
	Job, RunID string
	q          *q.Queries
	log        *slog.Logger
}

// Acquire is acquireCronLease; nil when another run holds the lease.
func Acquire(ctx context.Context, qs *q.Queries, log *slog.Logger, job string, ttl time.Duration, now time.Time) (*Lease, error) {
	runID := uuid.NewString()
	now = now.Truncate(time.Millisecond)
	ids, err := qs.AcquireCronLease(ctx, job, runID, jsontime.New(now), jsontime.New(now.Add(ttl)))
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 || ids[0] != runID {
		return nil, nil
	}
	return &Lease{Job: job, RunID: runID, q: qs, log: log}, nil
}

// Release expires the lease if it is still ours.
func (l *Lease) Release(ctx context.Context) {
	if err := l.q.ReleaseCronLease(context.WithoutCancel(ctx), l.Job, l.RunID); err != nil {
		l.log.Warn("Failed to release cron lease", "error", err, "jobName", l.Job, "runId", l.RunID)
	}
}

// MapWithConcurrency is mapWithConcurrency: at most limit calls run at once;
// once the deadline expires no new item starts. Results keep input order and
// cover the items before the first one that was not started.
func MapWithConcurrency[T, R any](items []T, limit int, fn func(T, int) R, d *Deadline) (results []R, remaining int) {
	limit = max(1, limit)
	slots := make([]*R, len(items))
	next, stoppedAt := 0, len(items)
	var mu sync.Mutex
	var wg sync.WaitGroup
	worker := func() {
		defer wg.Done()
		for {
			mu.Lock()
			if d.Expired() {
				stoppedAt = min(stoppedAt, next)
				mu.Unlock()
				return
			}
			i := next
			next++
			mu.Unlock()
			if i >= len(items) {
				return
			}
			r := fn(items[i], i)
			mu.Lock()
			slots[i] = &r
			mu.Unlock()
		}
	}
	for range min(limit, len(items)) {
		wg.Add(1)
		go worker()
	}
	wg.Wait()
	done := min(stoppedAt, len(items))
	for _, s := range slots[:done] {
		if s != nil {
			results = append(results, *s)
		}
	}
	return results, max(0, len(items)-done)
}
