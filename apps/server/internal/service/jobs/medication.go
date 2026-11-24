package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/cronjob"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/service/preventives"
	"github.com/denysovkos/migraine.club/internal/service/push"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// MaxLateMinutes is MAX_LATE_MINUTES; planWorkers is PLAN_CONCURRENCY.
const (
	MaxLateMinutes = 90
	planWorkers    = 8
)

// IsSlotDue is isSlotDue: the HH:mm slot has arrived in nowLocal's zone and
// is at most maxLate minutes old.
func IsSlotDue(nowLocal time.Time, loc *time.Location, slot string, maxLate float64) bool {
	parts := strings.Split(slot, ":")
	if len(parts) < 2 {
		return false
	}
	h, m := jsx.StringToNumber(parts[0]), jsx.StringToNumber(parts[1])
	if h != float64(int(h)) || m != float64(int(m)) || !jsx.IsFinite(h) || !jsx.IsFinite(m) {
		return false
	}
	target, ok := luxon.SetTime(nowLocal, loc, int(h), int(m), 0, 0)
	if !ok {
		return false
	}
	late := float64(nowLocal.UnixMilli()-target.UnixMilli()) / 60000
	return late >= 0 && late <= maxLate
}

// ReminderBody is reminderBody.
func ReminderBody(doseText *string, slot string) string {
	if doseText != nil && jsx.Trim(*doseText) != "" {
		return jsx.Trim(*doseText) + " · " + slot
	}
	return "Scheduled for " + slot
}

type reminderStats struct {
	mu                                                                                   sync.Mutex
	sent, notDueToday, alreadyLogged, alreadyReminded, noSubscription, remaining, failed int
}

func (s *reminderStats) add(f func()) { s.mu.Lock(); f(); s.mu.Unlock() }

// timezones resolves each distinct user's timezone once.
func (d Deps) timezones(ctx context.Context, users []string) (map[string]string, error) {
	seen := map[string]bool{}
	var unique []string
	for _, u := range users {
		if !seen[u] {
			seen[u] = true
			unique = append(unique, u)
		}
	}
	type res struct {
		user, zone string
		err        error
	}
	results, _ := cronjob.MapWithConcurrency(unique, planWorkers, func(u string, _ int) res {
		z, err := usertz.Get(ctx, d.Q, u)
		return res{u, z, err}
	}, nil)
	out := map[string]string{}
	for _, r := range results {
		if r.err != nil {
			return nil, r.err
		}
		out[r.user] = r.zone
	}
	return out, nil
}

func stringList(raw json.RawMessage) []string {
	var out []string
	_ = json.Unmarshal(raw, &out)
	return out
}

func (d Deps) remindPlan(ctx context.Context, p q.ReminderPlansRow, slots []string, zone string, st *reminderStats) error {
	loc, ok := tz.Load(zone)
	if !ok {
		return errors.New("invalid timezone " + zone)
	}
	nowLocal := d.Now().In(loc)
	localDate := luxon.ISODate(nowLocal)
	due := preventives.IsDueOnDate(preventives.Plan{ID: p.ID, Kind: "oral", ScheduleType: p.ScheduleType,
		Payload: preventives.DecodePayload(p.SchedulePayload), StartDate: p.StartDate.YMD(), Status: "active"}, localDate)
	if !due {
		st.add(func() { st.notDueToday++ })
		return nil
	}
	day, _ := time.Parse("2006-01-02", localDate)
	state, err := d.Q.PlanIntakeState(ctx, p.ID, jsontime.NewDate(day))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if state == "taken" {
		st.add(func() { st.alreadyLogged++ })
		return nil
	}
	sentRows, err := d.Q.SentReminderSlots(ctx, p.ID, jsontime.YMD(localDate), slots)
	if err != nil {
		return err
	}
	sent := map[string]bool{}
	for _, s := range sentRows {
		sent[s] = true
	}
	for _, slot := range slots {
		if sent[slot] && IsSlotDue(nowLocal, loc, slot, MaxLateMinutes) {
			st.add(func() { st.alreadyReminded++ })
		}
	}
	for _, slot := range slots {
		if sent[slot] || !IsSlotDue(nowLocal, loc, slot, MaxLateMinutes) {
			continue
		}
		res, err := d.Push.SendToUser(ctx, p.UserID, push.Payload{
			Title: "Time for " + p.Name, Body: ReminderBody(p.DoseText, slot),
			Tag:     strp("preventive-" + p.ID + "-" + localDate + "-" + slot),
			Actions: []any{httpx.O("action", "taken", "title", "✅ Taken")},
			Data: httpx.O("url", "/dashboard", "deepLink", "/dashboard", "programAction", httpx.O(
				"endpoint", "/api/preventives/intake",
				"body", httpx.O("planId", p.ID, "localDate", localDate, "state", "taken"))),
		})
		if err != nil {
			return err
		}
		if res.Sent == 0 {
			st.add(func() { st.noSubscription++ })
			continue
		}
		if err := d.Q.LogReminder(ctx, p.UserID, p.ID, jsontime.YMD(localDate), slot); err != nil {
			return err
		}
		st.add(func() { st.sent++ })
	}
	return nil
}

// MedicationReminders is medicationRemindersService.process.
func (d Deps) MedicationReminders(ctx context.Context, deadline *cronjob.Deadline) (*httpx.Object, error) {
	st := &reminderStats{}
	result := func() *httpx.Object {
		return httpx.O("sent", st.sent, "notDueToday", st.notDueToday, "alreadyLogged", st.alreadyLogged,
			"alreadyReminded", st.alreadyReminded, "noSubscription", st.noSubscription, "remaining", st.remaining, "failed", st.failed)
	}
	plans, err := d.Q.ReminderPlans(ctx)
	if err != nil {
		return nil, err
	}
	type item struct {
		plan  q.ReminderPlansRow
		slots []string
	}
	var actionable []item
	var users []string
	for _, p := range plans {
		if slots := stringList(p.ReminderTimes); len(slots) > 0 {
			actionable = append(actionable, item{p, slots})
			users = append(users, p.UserID)
		}
	}
	if len(actionable) == 0 {
		return result(), nil
	}
	zones, err := d.timezones(ctx, users)
	if err != nil {
		return nil, err
	}
	_, remaining := cronjob.MapWithConcurrency(actionable, planWorkers, func(it item, _ int) struct{} {
		zone, ok := zones[it.plan.UserID]
		if !ok {
			zone = "UTC"
		}
		if err := d.remindPlan(ctx, it.plan, it.slots, zone, st); err != nil {
			st.add(func() { st.failed++ })
			d.Log.Error("medication-reminders: plan failed", "error", err, "planId", it.plan.ID)
		}
		return struct{}{}
	}, deadline)
	st.remaining += remaining
	return result(), nil
}
