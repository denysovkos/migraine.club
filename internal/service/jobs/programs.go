package jobs

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/denysovkos/migraine.club/internal/cronjob"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/service/acutemeds"
	"github.com/denysovkos/migraine.club/internal/service/programs"
	"github.com/denysovkos/migraine.club/internal/service/push"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// Timing constants from programsRemindersService.
const (
	windDownLeadMinutes    = 30
	morningLagMinutes      = 30
	onsetNudgeDelayMinutes = 30
	fireWindowMinutes      = 6
	weeklyDigestHHMM       = "18:00"
	evalCompleteHHMM       = "09:00"
)

// ShouldSuppressForMoh is shouldSuppressForMoh.
func ShouldSuppressForMoh(status string) bool { return status == "exceeded" || status == "approaching" }

// IsOnsetNudgeDue is isOnsetNudgeDue.
func IsOnsetNudgeDue(now, onset time.Time, delay, window float64) bool {
	m := float64(now.UnixMilli()-onset.UnixMilli()) / 60000
	return m >= delay && m <= delay+window
}

// IsWithinFireWindow is isWithinFireWindow: nowLocal is within ±6 minutes
// of targetHHmm (shifted by offset minutes) on the same local day.
func IsWithinFireWindow(nowLocal time.Time, loc *time.Location, targetHHmm string, offset int) bool {
	parts := strings.Split(targetHHmm, ":")
	if len(parts) < 2 {
		return false
	}
	h, m := jsx.StringToNumber(parts[0]), jsx.StringToNumber(parts[1])
	if math.IsNaN(h) || math.IsNaN(m) || h != math.Trunc(h) || m != math.Trunc(m) {
		return false
	}
	target, ok := luxon.SetTime(nowLocal, loc, int(h), int(m), 0, 0)
	if !ok {
		return false
	}
	target = target.Add(time.Duration(offset) * time.Minute)
	return math.Abs(float64(nowLocal.UnixMilli()-target.UnixMilli())/60000) <= fireWindowMinutes
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	}
	return true
}

func jsonMap(raw json.RawMessage) map[string]any {
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if m == nil {
		m = map[string]any{}
	}
	return m
}

type programStats struct {
	mu                                                                                               sync.Mutex
	windDown, morningCheckIn, onsetNudge, suppressed, weeklyDigest, evalComplete, skipped, remaining int
}

func (s *programStats) add(f func()) { s.mu.Lock(); f(); s.mu.Unlock() }

func (d Deps) sentOn(ctx context.Context, uid, program, kind, localDate string) (bool, error) {
	return d.Q.NotificationSentOn(ctx, uid, program, kind, jsontime.YMD(localDate))
}

// notify sends a program push unless already logged, logging it when a
// device received it.
func (d Deps) notify(ctx context.Context, uid, program, kind, localDate string, attack *int32, p push.Payload) error {
	var sent bool
	var err error
	if attack != nil {
		sent, err = d.Q.NotificationSentForAttack(ctx, uid, kind, attack)
	} else {
		sent, err = d.sentOn(ctx, uid, program, kind, localDate)
	}
	if err != nil || sent {
		return err
	}
	res, err := d.Push.SendToUser(ctx, uid, p)
	if err != nil {
		return err
	}
	if res.Sent == 0 {
		return nil
	}
	return d.Q.LogProgramNotification(ctx, q.LogProgramNotificationParams{UserID: uid, ProgramID: program, Kind: kind,
		LocalDate: jsontime.YMD(localDate), AttackID: attack})
}

func link(url string) *httpx.Object { return httpx.O("url", url, "deepLink", url) }

func (d Deps) sleepReminders(ctx context.Context, e q.ActiveEnrollmentsWithConfigRow, st *programStats) {
	target := jsonMap(e.ProgramEnrollment.TargetPayload)
	bed, wake := target["bedTime"], target["wakeTime"]
	if !truthy(bed) || !truthy(wake) {
		st.add(func() { st.skipped++ })
		return
	}
	bedS, ok1 := bed.(string)
	wakeS, ok2 := wake.(string)
	loc, ok3 := tz.Load(e.ProgramEnrollment.Timezone)
	if !ok1 || !ok2 || !ok3 {
		d.Log.Warn("sleep reminder failed", "userId", e.ProgramEnrollment.UserID)
		return
	}
	config := jsonMap(e.NotificationsConfig)
	nowLocal := d.Now().In(loc)
	localDate := luxon.ISODate(nowLocal)
	uid := e.ProgramEnrollment.UserID
	if truthy(config["windDown"]) && IsWithinFireWindow(nowLocal, loc, bedS, -windDownLeadMinutes) {
		if err := d.notify(ctx, uid, "sleep-regularity", "wind_down", localDate, nil, push.Payload{
			Title: "Wind down 🌙", Body: "Bed time in 30 min (target " + bedS + ").", Tag: strp("sleep-wind-down"),
			Data: link("/dashboard")}); err != nil {
			d.Log.Warn("sleep reminder failed", "err", err, "userId", uid)
			return
		}
		st.add(func() { st.windDown++ })
	}
	if truthy(config["morningCheckIn"]) && IsWithinFireWindow(nowLocal, loc, wakeS, morningLagMinutes) {
		deep := "/quick/sleep?d=" + localDate + "&v=on_target"
		data := link(deep).Set("programAction", httpx.O("endpoint", "/api/programs/sleep-regularity/log",
			"body", httpx.O("localDate", localDate)))
		if err := d.notify(ctx, uid, "sleep-regularity", "morning_check_in", localDate, nil, push.Payload{
			Title: "How did you sleep?", Body: "Target " + bedS + "–" + wakeS + ". Tap to log.",
			Tag:     strp("sleep-morning-" + localDate),
			Actions: []any{httpx.O("action", "on_target", "title", "😴 On target"), httpx.O("action", "skip", "title", "Skip")},
			Data:    data}); err != nil {
			d.Log.Warn("sleep reminder failed", "err", err, "userId", uid)
			return
		}
		st.add(func() { st.morningCheckIn++ })
	}
}

func (d Deps) digestAndReview(ctx context.Context, e q.ActiveEnrollmentsWithConfigRow, progs *programs.Service, st *programStats) {
	en := e.ProgramEnrollment
	loc, ok := tz.Load(en.Timezone)
	if !ok {
		return
	}
	config := jsonMap(e.NotificationsConfig)
	nowLocal := d.Now().In(loc)
	localDate := luxon.ISODate(nowLocal)
	if truthy(config["weeklyDigest"]) && nowLocal.Weekday() == time.Sunday && IsWithinFireWindow(nowLocal, loc, weeklyDigestHHMM, 0) {
		err := func() error {
			summary, _, err := progs.Progress(ctx, en.UserID, en, localDate, en.ProgramID == "acute-med-timing")
			if err != nil {
				return err
			}
			adherence, _ := summary.Get("adherence")
			a, _ := adherence.(float64)
			evalEnd, _ := luxon.FromISO(string(en.EvaluationWindowEnd), loc, d.Now())
			days := max(0, math.Floor(luxon.DiffDays(evalEnd, loc, localdate.StartOfDay(nowLocal, loc), loc)))
			url := "/dashboard/programs/" + en.ProgramID + "/progress"
			return d.notify(ctx, en.UserID, en.ProgramID, "weekly_digest", localDate, nil, push.Payload{
				Title: "Your week so far",
				Body:  jsx.FormatNumber(jsx.Round(a*100)) + "% adherence · " + jsx.FormatNumber(days) + " days to review.",
				Tag:   strp("digest-" + en.ProgramID + "-" + localDate), Data: link(url)})
		}()
		if err != nil {
			d.Log.Warn("weekly digest failed", "err", err, "userId", en.UserID, "programId", en.ProgramID)
		} else {
			st.add(func() { st.weeklyDigest++ })
		}
	}
	evalEnd := string(en.EvaluationWindowEnd)
	if localDate >= evalEnd && IsWithinFireWindow(nowLocal, loc, evalCompleteHHMM, 0) {
		title := en.ProgramID
		for _, def := range programs.Definitions() {
			if def.ID == en.ProgramID {
				title = def.Title
			}
		}
		url := "/dashboard/programs/" + en.ProgramID + "/progress"
		if err := d.notify(ctx, en.UserID, en.ProgramID, "eval_complete", evalEnd, nil, push.Payload{
			Title: "Your " + title + " review is ready", Body: "Tap to see how the program went.",
			Tag: strp("eval-complete-" + en.ProgramID), Data: link(url)}); err != nil {
			d.Log.Warn("eval-complete push failed", "err", err, "userId", en.UserID, "programId", en.ProgramID)
		} else {
			st.add(func() { st.evalComplete++ })
		}
	}
}

func (d Deps) onsetNudges(ctx context.Context, e q.ActiveEnrollmentsWithConfigRow, now time.Time, st *programStats) {
	if !truthy(jsonMap(e.NotificationsConfig)["onsetNudge"]) {
		return
	}
	uid, zone := e.ProgramEnrollment.UserID, e.ProgramEnrollment.Timezone
	candidates, err := d.Q.OngoingAttacksSince(ctx, uid, jsontime.New(now.Add(-24*time.Hour)))
	if err != nil {
		d.Log.Warn("onset nudge candidate lookup failed", "err", err, "userId", uid)
		return
	}
	suppressed := false
	if moh, err := acutemeds.MohStatus(ctx, d.Q, uid, now, 30); err != nil {
		suppressed = true
		d.Log.Warn("MOH check failed; suppressing onset nudge", "err", err, "userId", uid)
	} else if status, _ := moh.Get("status"); ShouldSuppressForMoh(status.(string)) {
		suppressed = true
		d.Log.Info("onset nudge suppressed by MOH guardrail", "userId", uid, "mohStatus", status)
	}
	for _, a := range candidates {
		id := a.ID
		has, err := d.Q.AttackHasDose(ctx, uid, &id)
		if err != nil {
			d.Log.Warn("acute dose lookup failed", "err", err, "userId", uid, "attackId", id)
			continue
		}
		if has {
			continue
		}
		if suppressed {
			st.add(func() { st.suppressed++ })
			continue
		}
		onset := a.StartTime.Time
		if a.OnsetAt != nil && !a.OnsetAt.IsZero() {
			onset = a.OnsetAt.Time
		}
		if !IsOnsetNudgeDue(now, onset, onsetNudgeDelayMinutes, fireWindowMinutes) {
			continue
		}
		if err := d.notify(ctx, uid, "acute-med-timing", "onset_nudge", localdate.String(onset, zone), &id, push.Payload{
			Title: "Take your acute med soon", Body: "30 min since attack started. Earlier dosing helps.",
			Tag: strp("onset-" + strconv.Itoa(int(id))), Data: link("/dashboard")}); err != nil {
			d.Log.Warn("onset nudge failed", "err", err, "userId", uid, "attackId", id)
			continue
		}
		st.add(func() { st.onsetNudge++ })
	}
}

// ProgramsReminders is programsRemindersService.process.
func (d Deps) ProgramsReminders(ctx context.Context, progs *programs.Service, deadline *cronjob.Deadline) (*httpx.Object, error) {
	st := &programStats{}
	sleep, acute := "sleep-regularity", "acute-med-timing"
	run := func(filter *string, fn func(q.ActiveEnrollmentsWithConfigRow)) error {
		rows, err := d.Q.ActiveEnrollmentsWithConfig(ctx, filter)
		if err != nil {
			return err
		}
		_, remaining := cronjob.MapWithConcurrency(rows, 8, func(e q.ActiveEnrollmentsWithConfigRow, _ int) struct{} {
			fn(e)
			return struct{}{}
		}, deadline)
		st.add(func() { st.remaining += remaining })
		return nil
	}
	if err := run(&sleep, func(e q.ActiveEnrollmentsWithConfigRow) { d.sleepReminders(ctx, e, st) }); err != nil {
		return nil, err
	}
	if err := run(nil, func(e q.ActiveEnrollmentsWithConfigRow) { d.digestAndReview(ctx, e, progs, st) }); err != nil {
		return nil, err
	}
	now := d.Now()
	if err := run(&acute, func(e q.ActiveEnrollmentsWithConfigRow) { d.onsetNudges(ctx, e, now, st) }); err != nil {
		return nil, err
	}
	if st.remaining > 0 {
		d.Log.Info("programs reminders run cut short by time budget", "remaining", st.remaining)
	}
	return httpx.O("windDown", st.windDown, "morningCheckIn", st.morningCheckIn, "onsetNudge", st.onsetNudge,
		"onsetNudgeSuppressedByMoh", st.suppressed, "weeklyDigest", st.weeklyDigest, "evalComplete", st.evalComplete,
		"skipped", st.skipped, "remaining", st.remaining), nil
}
