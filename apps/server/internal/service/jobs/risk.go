package jobs

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/cronjob"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/i18n"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/service/pressure"
	"github.com/denysovkos/migraine.club/internal/service/push"
	"github.com/denysovkos/migraine.club/internal/service/spaceweather"
	"github.com/denysovkos/migraine.club/internal/service/wpi"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// Thresholds and limits from DailyRiskAlertService.
const (
	wpiHighThreshold  = 5.0
	kpStormThreshold  = 5.0
	maxAlertUsers     = 2000
	alertUserWorkers  = 8
	spaceWeatherLimit = 15 * time.Second
)

// IsNotBetween8pmAnd9am is isNotBetween8pmAnd9am: 09:00–19:59 local.
func IsNotBetween8pmAnd9am(local time.Time) bool {
	h := local.Hour()
	return h < 20 && h >= 9
}

// inAllowedWindow is isInUserAllowedWindow; an invalid zone is never allowed.
func inAllowedWindow(zone string, now time.Time) bool {
	loc, ok := tz.Load(zone)
	return ok && IsNotBetween8pmAnd9am(now.In(loc))
}

type solarForecast struct {
	kp float64
	ts time.Time
}

// FutureMaxKp is extractFutureMaxKpFromGfzRaw: the highest future Kp in the
// stored GFZ payload, earliest timestamp on ties.
func FutureMaxKp(raw any, now time.Time) (float64, time.Time, bool) {
	container, _ := raw.(map[string]any)
	candidate := raw
	if inner, ok := container["raw"]; ok && inner != nil {
		candidate = inner
	}
	c, _ := candidate.(map[string]any)
	dts, ok1 := c["datetime"].([]any)
	kps, ok2 := c["Kp"].([]any)
	if !ok1 || !ok2 || len(dts) != len(kps) {
		return 0, time.Time{}, false
	}
	var best *solarForecast
	for i := range dts {
		var s string
		if dts[i] != nil {
			s = jsx.String(dts[i])
		}
		ts, err := jsontime.Parse(s)
		if err != nil {
			continue
		}
		kp, isNum := kps[i].(float64)
		if !isNum {
			var ks string
			if kps[i] != nil {
				ks = jsx.String(kps[i])
			}
			kp = jsx.ParseFloat(ks)
		}
		if !jsx.IsFinite(kp) || !ts.After(now) {
			continue
		}
		if best == nil || kp > best.kp || (kp == best.kp && ts.Before(best.ts)) {
			best = &solarForecast{kp, ts}
		}
	}
	if best == nil {
		return 0, time.Time{}, false
	}
	return best.kp, best.ts, true
}

func (d Deps) solarForecast(ctx context.Context, now time.Time) (*solarForecast, error) {
	raw, err := d.Q.LatestGfzRaw(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v, err := jsx.ParseJSON(raw)
	if err != nil || v == nil {
		return nil, nil
	}
	kp, ts, ok := FutureMaxKp(toPlain(v), now)
	if !ok {
		return nil, nil
	}
	return &solarForecast{kp, ts}, nil
}

// toPlain turns ParseJSON output into maps for FutureMaxKp.
func toPlain(v any) any {
	switch x := v.(type) {
	case *jsx.JSONObject:
		m := map[string]any{}
		for _, k := range x.Keys() {
			e, _ := x.Get(k)
			m[k] = toPlain(e)
		}
		return m
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = toPlain(e)
		}
		return out
	}
	return v
}

type userOutcome struct {
	status string
}

func countOutcomes(results []userOutcome) (sent, skipped, failed, already int) {
	for _, r := range results {
		switch r.status {
		case "sent":
			sent++
		case "skipped":
			skipped++
		case "failed":
			failed++
		default:
			already++
		}
	}
	return
}

// RiskDeps adds what daily risk needs.
type RiskDeps struct {
	Deps
	WPI      *wpi.Service
	KP       *spaceweather.Repo
	Pressure *pressure.Service
}

func (d RiskDeps) sendRisk(ctx context.Context, uid string, wpiHigh bool, score *float64, sf *solarForecast, zone, lang string) error {
	t, err := i18n.New(lang, "Push")
	if err != nil {
		return err
	}
	var parts []string
	if wpiHigh {
		s := ""
		if score != nil {
			s = jsx.ToFixed(*score, 1)
		}
		parts = append(parts, t("dailyRisk.wpiPart", "score", s))
	}
	if sf != nil && sf.kp >= kpStormThreshold {
		expected := t("dailyRisk.unknownTime")
		if zone != "" {
			if loc, ok := tz.Load(zone); ok {
				expected = sf.ts.In(loc).Format("Jan 2, 15:04")
			}
		}
		z := zone
		if z == "" {
			z = t("dailyRisk.localTime")
		}
		parts = append(parts, t("dailyRisk.solarPart", "expectedAt", expected, "timezone", z, "kp", jsx.ToFixed(sf.kp, 1)))
	}
	body := ""
	for i, p := range parts {
		if i > 0 {
			body += " "
		}
		body += p
	}
	_, err = d.Push.SendToUser(ctx, uid, push.Payload{Title: t("dailyRisk.title"), Body: body,
		Icon: strp("/android-chrome-192x192.png"), Badge: strp("/android-icon-72x72.png"), URL: strp("/dashboard"),
		Tag: strp("daily-risk-alert"), RequireInter: boolp(false)})
	return err
}

func (d RiskDeps) riskUser(ctx context.Context, uid, zone, lang string, now time.Time, sf *solarForecast) string {
	if !inAllowedWindow(zone, now) {
		return "skipped"
	}
	localDate := localdate.String(now, zone)
	var score *float64
	var level *string
	if c, err := d.WPI.Current(ctx, uid); err != nil {
		d.Log.Warn("Failed to compute WPI for user", "userId", uid, "error", err)
	} else {
		s, l := c.Result.Score, c.Result.Level
		score, level = &s, &l
	}
	wpiHigh := score != nil && *score >= wpiHighThreshold
	solarHigh := sf != nil && sf.kp >= kpStormThreshold
	if !wpiHigh && !solarHigh {
		return "skipped"
	}
	ids, err := d.Q.InsertRiskAlertRun(ctx, uid, localDate, "daily_risk")
	if err != nil || len(ids) == 0 {
		return "already_processed"
	}
	details := httpx.O()
	if score != nil {
		details.Set("wpiScore", *score).Set("wpiLevel", *level)
	}
	var kp, ts any
	if sf != nil {
		kp, ts = sf.kp, jsontime.Format(sf.ts)
	}
	details.Set("wpiHigh", wpiHigh).Set("solarHigh", solarHigh).Set("solarForecastKp", kp).
		Set("solarForecastTimestampUtc", ts).Set("timezone", zone)
	status := "sent"
	if err := d.sendRisk(ctx, uid, wpiHigh, score, sf, zone, lang); err != nil {
		status = "failed"
		details.Set("errorMessage", err.Error())
	}
	b, _ := httpx.Marshal(details)
	if err := d.Q.UpdateRiskAlertRun(ctx, q.UpdateRiskAlertRunParams{Status: status, Details: b, UserID: uid, LocalDate: localDate, Type: "daily_risk"}); err != nil {
		d.Log.Error("Error processing user", "userId", uid, "error", err)
		return "failed"
	}
	return status
}

// DailyRisk is dailyRiskAlertService.processAlerts; the summary has no
// per-user results, as the cron response left them out.
func (d RiskDeps) DailyRisk(ctx context.Context, now time.Time, deadline *cronjob.Deadline) (*httpx.Object, error) {
	started := time.Now()
	d.Log.Info("Starting daily risk alert processing", "nowUtc", jsontime.Format(now))
	syncDone := make(chan error, 1)
	go func() {
		_, err := d.KP.SyncFromSources(context.WithoutCancel(ctx), now)
		syncDone <- err
	}()
	select {
	case err := <-syncDone:
		if err != nil {
			d.Log.Warn("Failed to sync space weather Kp during alert job; proceeding with DB data", "error", err)
		}
	case <-time.After(spaceWeatherLimit):
		d.Log.Warn("Failed to sync space weather Kp during alert job; proceeding with DB data", "error", "space weather sync timed out after 15000ms")
	}
	empty := func() *httpx.Object {
		return httpx.O("eligibleTimezones", []any{}, "usersProcessed", 0, "sent", 0, "skipped", 0, "failed", 0,
			"alreadyProcessed", 0, "truncated", false, "remaining", 0)
	}
	sf, err := d.solarForecast(ctx, now)
	if err != nil {
		return nil, err
	}
	users, err := d.Q.AlertEnabledUsers(ctx)
	if err != nil {
		return nil, err
	}
	if len(users) == 0 {
		d.Log.Info("No users with alerts enabled")
		return empty(), nil
	}
	truncated := len(users) > maxAlertUsers
	batch := users[:min(len(users), maxAlertUsers)]
	results, remaining := cronjob.MapWithConcurrency(batch, alertUserWorkers, func(u q.AlertEnabledUsersRow, _ int) userOutcome {
		return userOutcome{d.riskUser(ctx, u.UserID, u.Timezone, u.PreferredLanguage, now, sf)}
	}, deadline)
	sent, skipped, failed, already := countOutcomes(results)
	zones := []any{}
	seen := map[string]bool{}
	for _, u := range users {
		if u.Timezone != "" && !seen[u.Timezone] && inAllowedWindow(u.Timezone, now) {
			seen[u.Timezone] = true
			zones = append(zones, u.Timezone)
		}
	}
	d.Log.Info("Daily risk alert processing complete", "duration", time.Since(started).Milliseconds(), "usersProcessed", len(results),
		"sent", sent, "skipped", skipped, "failed", failed, "alreadyProcessed", already, "truncated", truncated, "remaining", remaining)
	return httpx.O("eligibleTimezones", zones, "usersProcessed", len(results), "sent", sent, "skipped", skipped,
		"failed", failed, "alreadyProcessed", already, "truncated", truncated, "remaining", remaining), nil
}

// weekdays are Luxon's standalone weekday names (cccc), Monday first.
var weekdays = map[string][7]string{
	"en": {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"},
	"fr": {"lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"},
	"uk": {"понеділок", "вівторок", "середа", "четвер", "пʼятниця", "субота", "неділя"},
}

func (d RiskDeps) pressureUser(ctx context.Context, u q.PressureThresholdUsersRow, now time.Time) string {
	loc, ok := tz.Load(u.Timezone)
	if !ok || !IsNotBetween8pmAnd9am(now.In(loc)) {
		return "skipped"
	}
	days, err := d.Pressure.OutlookDays(ctx, u.Lat, u.Lon, u.Timezone, u.PressureDropThresholdHpa, now)
	if err != nil {
		d.Log.Error("Error processing pressure alert", "userId", u.UserID, "error", err)
		return "failed"
	}
	today := luxon.ISODate(now.In(loc))
	drop := pressure.FindUpcomingDrop(days, today, pressure.AlertHorizonDays)
	if drop == nil {
		return "skipped"
	}
	change, ok := drop.Change()
	if !ok {
		return "skipped"
	}
	dropHpa := change
	if dropHpa < 0 {
		dropHpa = -dropHpa
	}
	ids, err := d.Q.InsertRiskAlertRun(ctx, u.UserID, drop.Date, "pressure_drop")
	if err != nil {
		d.Log.Error("Error processing pressure alert", "userId", u.UserID, "error", err)
		return "failed"
	}
	if len(ids) == 0 {
		return "already_processed"
	}
	details := httpx.O("dropHpa", dropHpa, "thresholdHpa", *u.PressureDropThresholdHpa, "timezone", u.Timezone)
	status := "sent"
	err = func() error {
		t, err := i18n.New(u.PreferredLanguage, "Push")
		if err != nil {
			return err
		}
		todayT, _ := time.Parse(localdate.Layout, today)
		day := t("pressureDrop.tomorrow")
		if drop.Date != todayT.AddDate(0, 0, 1).Format(localdate.Layout) {
			dt, _ := time.Parse(localdate.Layout, drop.Date)
			names := weekdays[u.PreferredLanguage]
			day = t("pressureDrop.onDay", "weekday", names[(int(dt.Weekday())+6)%7])
		}
		_, err = d.Push.SendToUser(ctx, u.UserID, push.Payload{Title: t("pressureDrop.title"),
			Body: t("pressureDrop.body", "drop", jsx.ToFixed(dropHpa, 1), "day", day),
			Icon: strp("/android-chrome-192x192.png"), Badge: strp("/android-icon-72x72.png"), URL: strp("/dashboard"),
			Tag: strp("pressure-drop-alert"), RequireInter: boolp(false)})
		return err
	}()
	if err != nil {
		status = "failed"
		details.Set("errorMessage", err.Error())
	}
	b, _ := httpx.Marshal(details)
	if err := d.Q.UpdateRiskAlertRun(ctx, q.UpdateRiskAlertRunParams{Status: status, Details: b, UserID: u.UserID, LocalDate: drop.Date, Type: "pressure_drop"}); err != nil {
		return "failed"
	}
	return status
}

// PressureAlerts is pressureAlertService.processAlerts.
func (d RiskDeps) PressureAlerts(ctx context.Context, now time.Time, deadline *cronjob.Deadline) (*httpx.Object, error) {
	users, err := d.Q.PressureThresholdUsers(ctx)
	if err != nil {
		return nil, err
	}
	out := httpx.O("usersProcessed", 0, "sent", 0, "skipped", 0, "failed", 0, "alreadyProcessed", 0, "truncated", false, "remaining", 0)
	if len(users) == 0 {
		return out, nil
	}
	batch := users[:min(len(users), maxAlertUsers)]
	results, remaining := cronjob.MapWithConcurrency(batch, alertUserWorkers, func(u q.PressureThresholdUsersRow, _ int) userOutcome {
		return userOutcome{d.pressureUser(ctx, u, now)}
	}, deadline)
	sent, skipped, failed, already := countOutcomes(results)
	d.Log.Info("Pressure alert processing complete", "usersProcessed", len(results), "sent", sent, "failed", failed, "remaining", remaining)
	return httpx.O("usersProcessed", len(results), "sent", sent, "skipped", skipped, "failed", failed,
		"alreadyProcessed", already, "truncated", len(users) > maxAlertUsers, "remaining", remaining), nil
}
