package insights

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// MethodVersion is insightsService.methodVersion.
var MethodVersion = DefaultConfig.MethodVersion

// Service is InsightsService with InsightsCacheStore.
type Service struct {
	Q   *q.Queries
	Log *slog.Logger
	Now func() time.Time
}

// Latest is insightsCacheStore.getLatest; nil when there is none.
func (s *Service) Latest(ctx context.Context, uid string, windowDays int) (*q.InsightsCache, error) {
	row, err := s.Q.LatestInsightsCache(ctx, uid, int32(windowDays), MethodVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// ComputeForUser is computeForUser.
func (s *Service) ComputeForUser(ctx context.Context, uid string, windowDays int, now time.Time) (Result, error) {
	cfg := DefaultConfig
	cfg.WindowDays = windowDays
	nowMs := now.UnixMilli()
	start := time.UnixMilli(nowMs - int64(windowDays)*24*hourMs)
	zone, err := usertz.Get(ctx, s.Q, uid)
	if err != nil {
		return Result{}, err
	}
	epRows, err := s.Q.InsightEpisodes(ctx, uid, jsontime.New(start.Add(-48*time.Hour)), jsontime.New(now))
	if err != nil {
		return Result{}, err
	}
	episodes := make([]Episode, len(epRows))
	for i, r := range epRows {
		ep := Episode{ID: r.ID, StartMs: r.StartTime.UnixMilli(), IsOngoing: r.IsOngoing}
		if r.EndTime != nil {
			v := r.EndTime.UnixMilli()
			ep.EndMs = &v
		}
		episodes[i] = ep
	}
	evRows, err := s.Q.InsightFactorEvents(ctx, uid, jsontime.New(start), jsontime.New(now))
	if err != nil {
		return Result{}, err
	}
	events := make([]FactorEvent, len(evRows))
	var ids []string
	seen := map[string]bool{}
	for i, r := range evRows {
		events[i] = FactorEvent{FactorID: r.FactorID, OccurredMs: r.OccurredAt.UnixMilli()}
		if !seen[r.FactorID] {
			seen[r.FactorID] = true
			ids = append(ids, r.FactorID)
		}
	}
	loc := tz.LoadOrUTC(zone)
	l := now.In(loc)
	endDay := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)
	dates, err := s.Q.DiaryDatesBetween(ctx, uid, jsontime.NewDate(endDay.AddDate(0, 0, -(windowDays-1))), jsontime.NewDate(endDay))
	if err != nil {
		return Result{}, err
	}
	diary := make([]string, len(dates))
	for i, d := range dates {
		diary[i] = d.YMD()
	}
	var factors []Factor
	if len(ids) > 0 {
		rows, err := s.Q.FactorsByIDs(ctx, ids)
		if err != nil {
			return Result{}, err
		}
		for _, r := range rows {
			factors = append(factors, Factor{ID: r.ID, DisplayName: r.DisplayName, Type: r.Type})
		}
	}
	return Compute(uid, now, cfg, episodes, factors, events, diary, zone, s.Now), nil
}

// ComputeAndStore is computeAndStoreForUser: a failed cache write is only
// logged.
func (s *Service) ComputeAndStore(ctx context.Context, uid string, windowDays int, now time.Time) (Result, error) {
	started := s.Now()
	res, err := s.ComputeForUser(ctx, uid, windowDays, now)
	if err != nil {
		return Result{}, err
	}
	payload, _ := httpx.Marshal(res.Payload)
	stats, _ := httpx.Marshal(res.Payload.InputStats)
	if err := s.Q.UpsertInsightsCache(ctx, q.UpsertInsightsCacheParams{
		UserID: uid, WindowDays: int32(windowDays), MethodVersion: MethodVersion, ComputedAt: jsontime.New(now),
		PayloadJson: payload, InputStatsJson: stats,
	}); err != nil {
		s.Log.Error("Failed to upsert insights cache", "userId", uid, "windowDays", windowDays, "error", err)
	}
	cards := 0
	for _, b := range res.Payload.Buckets {
		cards += len(b.Items)
	}
	metric := "insights_compute_success"
	if res.Status == "insufficient_data" {
		metric = "insights_compute_insufficient_data"
	}
	s.Log.Info("Insights computed", "metric", metric, "userId", uid, "windowDays", windowDays,
		"methodVersion", MethodVersion, "status", res.Status, "cards", cards, "runtimeMs", s.Now().Sub(started).Milliseconds())
	return res, nil
}

// TestPlans is the GET /api/insights/test-plans list.
func (s *Service) TestPlans(ctx context.Context, uid string, status *string) ([]any, error) {
	zone, err := usertz.Get(ctx, s.Q, uid)
	if err != nil {
		return nil, err
	}
	loc := tz.LoadOrUTC(zone)
	plans, err := s.Q.ListInsightTestPlans(ctx, uid, status)
	if err != nil {
		return nil, err
	}
	out := []any{}
	for _, p := range plans {
		start := p.StartDate.Time
		days := int(p.DurationDays)
		ymd := func(t time.Time) string { return t.Format(localdate.Layout) }
		rStart, rEnd := ymd(start), ymd(start.AddDate(0, 0, days-1))
		bStart, bEnd := ymd(start.AddDate(0, 0, -days)), ymd(start.AddDate(0, 0, -1))
		during, err := s.Q.DiaryDatesBetween(ctx, uid, jsontime.NewDate(start), jsontime.NewDate(start.AddDate(0, 0, days-1)))
		if err != nil {
			return nil, err
		}
		before, err := s.Q.DiaryDatesBetween(ctx, uid, jsontime.NewDate(start.AddDate(0, 0, -days)), jsontime.NewDate(start.AddDate(0, 0, -1)))
		if err != nil {
			return nil, err
		}
		from, _ := localdate.ParseInZone(bStart, loc)
		endDay, _ := localdate.ParseInZone(rEnd, loc)
		// endOf('day'): the last millisecond before the next local midnight.
		to := localdate.StartOfDay(endDay.AddDate(0, 0, 1), loc).Add(-time.Millisecond)
		starts, err := s.Q.EpisodeStartsBetween(ctx, uid, jsontime.New(from), jsontime.New(to))
		if err != nil {
			return nil, err
		}
		count := func(a, b string) int {
			n := 0
			for _, st := range starts {
				if l := localdate.String(st.Time, zone); l >= a && l <= b {
					n++
				}
			}
			return n
		}
		perWeek := func(n int) float64 {
			if days > 0 {
				return float64(n) / (float64(days) / 7)
			}
			return 0
		}
		coverage := func(n int) float64 {
			if days > 0 {
				return float64(n) / float64(days)
			}
			return 0
		}
		bc, dc := count(bStart, bEnd), count(rStart, rEnd)
		factorName, factorType, notes := "Factor", "trigger", ""
		if p.FactorName != nil {
			factorName = *p.FactorName
		}
		if p.FactorType != nil {
			factorType = *p.FactorType
		}
		if p.Notes != nil {
			notes = *p.Notes
		}
		var completed any
		if p.CompletedAt != nil {
			completed = jsontime.Format(p.CompletedAt.Time)
		}
		out = append(out, httpx.O(
			"id", p.ID, "factorId", p.FactorID, "factorName", factorName, "factorType", factorType, "direction", p.Direction,
			"startDate", rStart, "endDate", rEnd, "durationDays", days, "notes", notes, "reminderEnabled", p.ReminderEnabled,
			"status", p.Status, "completedAt", completed, "createdAt", jsontime.Format(p.CreatedAt.Time),
			"updatedAt", jsontime.Format(p.UpdatedAt.Time),
			"comparison", httpx.O(
				"before", httpx.O("attackStarts", bc, "attackStartsPerWeek", Num(perWeek(bc)), "diaryCoveragePct", Num(coverage(len(before)))),
				"during", httpx.O("attackStarts", dc, "attackStartsPerWeek", Num(perWeek(dc)), "diaryCoveragePct", Num(coverage(len(during))))),
		))
	}
	return out, nil
}
