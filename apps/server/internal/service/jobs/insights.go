package jobs

import (
	"context"
	"sync/atomic"

	"github.com/denysovkos/migraine.club/internal/cronjob"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/insights"
)

// insightsWorkers is INSIGHTS_USER_CONCURRENCY.
const insightsWorkers = 4

// Insights is insightsService.computeForAllUsers.
func (d Deps) Insights(ctx context.Context, svc *insights.Service, windowDays int, deadline *cronjob.Deadline) (*httpx.Object, error) {
	users, err := d.Q.ActiveConsentUsers(ctx, 2000)
	if err != nil {
		return nil, err
	}
	var computed, insufficient, failed atomic.Int64
	_, remaining := cronjob.MapWithConcurrency(users, insightsWorkers, func(uid string, _ int) struct{} {
		res, err := svc.ComputeAndStore(ctx, uid, windowDays, d.Now())
		if err != nil {
			failed.Add(1)
			d.Log.Error("Insights compute failed for user", "error", err, "userId", uid)
			return struct{}{}
		}
		computed.Add(1)
		if res.Status != "ok" {
			insufficient.Add(1)
		}
		return struct{}{}
	}, deadline)
	return httpx.O("users", len(users), "computed", computed.Load(), "insufficient", insufficient.Load(),
		"failed", failed.Load(), "remaining", remaining), nil
}
