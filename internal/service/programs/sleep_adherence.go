package programs

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// SleepTarget is SleepTargetPayload.
type SleepTarget struct {
	BedTime          string  `json:"bedTime"`
	WakeTime         string  `json:"wakeTime"`
	ToleranceMinutes float64 `json:"toleranceMinutes"`
}

// toMinutes is `hhmm.split(':').map(Number)` → h*60+m (NaN → NaN).
func toMinutes(hhmm string) float64 {
	parts := strings.Split(hhmm, ":")
	h := jsx.ToNumber(parts[0])
	m := 0.0
	if len(parts) > 1 {
		m = jsx.ToNumber(parts[1])
	}
	return h*60 + m
}

func circularDelta(a, b string) float64 {
	d := math.Abs(toMinutes(a) - toMinutes(b))
	return math.Min(d, 24*60-d)
}

// SleepSignal is computeSleepDailySignal.
func SleepSignal(t SleepTarget, bed, wake *string) string {
	if bed == nil || *bed == "" || wake == nil || *wake == "" {
		return "na"
	}
	if circularDelta(*bed, t.BedTime) <= t.ToleranceMinutes && circularDelta(*wake, t.WakeTime) <= t.ToleranceMinutes {
		return "hit"
	}
	return "miss"
}

// RecordSleepAdherence is recordSleepAdherenceForDay. source "" is "diary".
func RecordSleepAdherence(ctx context.Context, qs *q.Queries, userID, ymd string, bed, wake *string, source string) error {
	if source == "" {
		source = "diary"
	}
	enrollment, err := qs.ActiveEnrollment(ctx, userID, "sleep-regularity")
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if ymd < string(enrollment.StartDate) {
		return nil
	}
	var target SleepTarget
	_ = json.Unmarshal(enrollment.TargetPayload, &target)
	signal := SleepSignal(target, bed, wake)
	payload, _ := httpx.Marshal(httpx.O("bedTime", bed, "wakeTime", wake))
	day := jsontime.YMD(ymd)

	id, err := qs.SleepAdherenceEventForDay(ctx, enrollment.ID, &day)
	switch {
	case err == nil:
		return qs.UpdateAdherenceEvent(ctx, signal, source, payload, id)
	case !errors.Is(err, pgx.ErrNoRows):
		return err
	}
	return qs.InsertDayAdherenceEvent(ctx, q.InsertDayAdherenceEventParams{
		EnrollmentID: enrollment.ID, UserID: userID, ProgramID: "sleep-regularity", LocalDate: &day,
		Signal: signal, Source: source, Payload: payload,
	})
}
