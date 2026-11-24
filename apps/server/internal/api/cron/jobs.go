package cron

import (
	"context"
	"time"

	"github.com/go-chi/chi/v5"

	pushapi "github.com/denysovkos/migraine.club/internal/api/push"
	"github.com/denysovkos/migraine.club/internal/api/weather"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/cronjob"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/insights"
	"github.com/denysovkos/migraine.club/internal/service/jobs"
	"github.com/denysovkos/migraine.club/internal/service/pressure"
	"github.com/denysovkos/migraine.club/internal/service/programs"
	"github.com/denysovkos/migraine.club/internal/service/spaceweather"
)

// insightsWindowDays is WINDOW_DAYS of the insights cron.
const insightsWindowDays = 90

// Mount registers every /api/cron/* route.
func Mount(r chi.Router, d *app.Deps) {
	base := jobs.Deps{Q: d.Q, Log: d.Log, Push: pushapi.NewService(d), Now: d.Clock}
	kp := &spaceweather.Repo{Q: d.Q, HTTP: d.HTTP, Log: d.Log}
	w := weather.NewWPI(d)
	risk := jobs.RiskDeps{Deps: base, WPI: w, KP: kp, Pressure: &pressure.Service{Q: d.Q, WPI: w, Now: d.Clock}}

	mount(r, d, Job{Name: "daily-risk", Description: "Daily risk alert cron - runs every 4 hours",
		Run: func(ctx context.Context, dl *cronjob.Deadline, _ string) (*httpx.Object, error) {
			res, err := risk.DailyRisk(ctx, d.Clock(), dl)
			if err != nil {
				return nil, err
			}
			p, err := risk.PressureAlerts(ctx, d.Clock(), dl)
			if err != nil {
				return nil, err
			}
			return res.Set("pressure", p), nil
		}})
	mount(r, d, Job{Name: "insights", Description: "Insights cron - recomputes conservative within-person associations",
		Disabled: !d.Cfg.EnableInsights,
		Run: func(ctx context.Context, dl *cronjob.Deadline, _ string) (*httpx.Object, error) {
			return base.Insights(ctx, &insights.Service{Q: d.Q, Log: d.Log, Now: d.Clock}, insightsWindowDays, dl)
		}})
	mount(r, d, Job{Name: "medication-reminders", Description: "Medication reminders cron - runs every 30 minutes", RunOnGet: true,
		Run: func(ctx context.Context, dl *cronjob.Deadline, _ string) (*httpx.Object, error) {
			return base.MedicationReminders(ctx, dl)
		}})
	mount(r, d, Job{Name: "programs-reminders", Description: "Programs reminders cron - runs every 5 minutes", RunOnGet: true,
		Run: func(ctx context.Context, dl *cronjob.Deadline, _ string) (*httpx.Object, error) {
			return base.ProgramsReminders(ctx, &programs.Service{Q: d.Q, Now: d.Clock}, dl)
		}})
	mount(r, d, Job{Name: "solar-activity", Description: "Solar activity sync cron - runs every 6 hours", Budget: 30 * time.Second,
		Run: func(ctx context.Context, _ *cronjob.Deadline, _ string) (*httpx.Object, error) {
			res, err := kp.SyncFromSources(ctx, d.Clock())
			if err != nil {
				return nil, err
			}
			return httpx.O("inserted", res.Inserted, "insertedBySource", res.InsertedBySource), nil
		}})
	mount(r, d, Job{Name: "stale-episode-reminder", Description: "Stale episode reminder cron - runs hourly",
		Disabled: !d.Cfg.EnableStaleEpisodeReminder, RunOnGet: true,
		Run: func(ctx context.Context, dl *cronjob.Deadline, _ string) (*httpx.Object, error) {
			return base.StaleEpisodes(ctx, d.Clock(), dl)
		}})
}
