package insights

import (
	"time"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
)

func insightsInsert(uid string, m map[string]any, start time.Time, days int32, reminder bool, now time.Time) q.InsertInsightTestPlanParams {
	return q.InsertInsightTestPlanParams{
		UserID: uid, FactorID: m["factorId"].(string), Direction: m["direction"].(string),
		StartDate: jsontime.NewDate(start), DurationDays: days, Notes: strp(m, "notes"), ReminderEnabled: reminder,
		Now: jsontime.New(now),
	}
}

func planPatch(uid, id string, status *string, hasNotes bool, notes *string, m map[string]any, now time.Time) q.UpdateInsightTestPlanParams {
	p := q.UpdateInsightTestPlanParams{
		Status: status, SetCompleted: status != nil && *status == "completed", Now: jsontime.New(now),
		SetNotes: hasNotes, Notes: notes, UserID: uid, ID: id,
	}
	if v, ok := m["reminderEnabled"].(bool); ok {
		p.ReminderEnabled = &v
	}
	return p
}
