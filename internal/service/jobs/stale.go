// Package jobs holds the cron job services: stale-episode reminders,
// medication and program reminders, daily risk and pressure alerts.
package jobs

import (
	"context"
	"log/slog"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/denysovkos/migraine.club/internal/cronjob"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/i18n"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/push"
)

// Deps are what the job services share.
type Deps struct {
	Q    *q.Queries
	Log  *slog.Logger
	Push *push.Service
	Now  func() time.Time
}

func strp(s string) *string { return &s }

func boolp(b bool) *bool { return &b }

const (
	staleAfter          = 48 * time.Hour
	maxStalePerRun      = 500
	staleEpisodeWorkers = 8
)

// languages maps user ids to their preferred language.
func (d Deps) languages(ctx context.Context, ids []string) (map[string]string, error) {
	rows, err := d.Q.UserLanguages(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, r := range rows {
		out[r.ID] = r.PreferredLanguage
	}
	return out, nil
}

// StaleEpisodes is StaleEpisodeReminderService.process.
func (d Deps) StaleEpisodes(ctx context.Context, now time.Time, deadline *cronjob.Deadline) (*httpx.Object, error) {
	started := time.Now()
	ok, err := d.Push.Configured()
	if err != nil {
		return nil, err
	}
	if !ok {
		d.Log.Warn("Push not configured; skipping stale episode reminders")
		return httpx.O("scanned", 0, "eligible", 0, "notified", 0, "skippedNotConfigured", true, "failed", 0, "remaining", 0), nil
	}
	now = now.Truncate(time.Millisecond)
	claimed, err := d.Q.ClaimStaleEpisodes(ctx, jsontime.Ptr(now), jsontime.New(now), jsontime.New(now.Add(-staleAfter)), maxStalePerRun)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var ids []string
	for _, ep := range claimed {
		if ep.UserID != "" && !seen[ep.UserID] {
			seen[ep.UserID] = true
			ids = append(ids, ep.UserID)
		}
	}
	langs := map[string]string{}
	if len(ids) > 0 {
		if langs, err = d.languages(ctx, ids); err != nil {
			return nil, err
		}
	}
	var failed atomic.Int64
	_, remaining := cronjob.MapWithConcurrency(claimed, staleEpisodeWorkers, func(ep q.ClaimStaleEpisodesRow, _ int) struct{} {
		id := strconv.Itoa(int(ep.ID))
		t, err := i18n.New(langs[ep.UserID], "Push")
		if err == nil {
			_, err = d.Push.SendToUser(ctx, ep.UserID, push.Payload{Title: t("staleEpisode.title"), Body: t("staleEpisode.body"),
				Icon: strp("/android-chrome-192x192.png"), Badge: strp("/android-icon-72x72.png"),
				URL: strp("/dashboard/episodes/" + id), Tag: strp("episode:" + id + ":stale48h"),
				Renotify: boolp(false), RequireInter: boolp(false)})
		}
		if err != nil {
			failed.Add(1)
			d.Log.Error("Failed to send stale episode reminder", "error", err, "episodeId", ep.ID, "userId", ep.UserID)
		}
		return struct{}{}
	}, deadline)
	notified := len(claimed) - remaining - int(failed.Load())
	if remaining > 0 {
		d.Log.Info("Stale episode reminder run cut short by time budget", "remaining", remaining, "eligible", len(claimed))
	}
	d.Log.Info("Stale episode reminder processing complete", "duration", time.Since(started).Milliseconds(),
		"eligible", len(claimed), "notified", notified, "failed", failed.Load(), "remaining", remaining)
	return httpx.O("scanned", 0, "eligible", len(claimed), "notified", notified, "skippedNotConfigured", false,
		"failed", failed.Load(), "remaining", remaining), nil
}
