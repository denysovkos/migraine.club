// Package programs holds the programs-module services.
package programs

import (
	"context"
	"encoding/json"
	"errors"
	"math"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/localdate"
)

// AcuteSignal is computeAcuteAttackSignal: na without a dose or with a dose
// logged before onset, hit within the window, miss after it.
func AcuteSignal(targetMinutes float64, onsetToDose *float64) string {
	if onsetToDose == nil || *onsetToDose < 0 {
		return "na"
	}
	if *onsetToDose <= targetMinutes {
		return "hit"
	}
	return "miss"
}

// RecordAcuteAdherence is recordAcuteAdherenceForAttack. source "" is
// "computed".
func RecordAcuteAdherence(ctx context.Context, qs *q.Queries, userID string, attackID int32, source string) error {
	if source == "" {
		source = "computed"
	}
	enrollment, err := qs.ActiveEnrollment(ctx, userID, "acute-med-timing")
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	attack, err := qs.AttackOnset(ctx, attackID, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	onset := attack.StartTime.Time
	if attack.OnsetAt != nil {
		onset = attack.OnsetAt.Time
	}
	if localdate.String(onset, enrollment.Timezone) < string(enrollment.StartDate) {
		return nil
	}

	var delta *float64
	first, err := qs.FirstDoseForAttack(ctx, &attackID, userID)
	switch {
	case err == nil:
		// Math.round((takenAt - onset) / 60000)
		v := math.Floor(float64(first.Sub(onset).Milliseconds())/60000 + 0.5)
		delta = &v
	case !errors.Is(err, pgx.ErrNoRows):
		return err
	}

	var target struct {
		AcuteWindowMinutes *float64 `json:"acuteWindowMinutes"`
	}
	_ = json.Unmarshal(enrollment.TargetPayload, &target)
	window := 30.0
	if target.AcuteWindowMinutes != nil {
		window = *target.AcuteWindowMinutes
	}
	signal := AcuteSignal(window, delta)
	payload, _ := json.Marshal(map[string]any{"onsetToDoseMinutes": delta})

	existingID, err := qs.AdherenceEventForAttack(ctx, enrollment.ID, &attackID)
	switch {
	case err == nil:
		return qs.UpdateAdherenceEvent(ctx, signal, source, payload, existingID)
	case !errors.Is(err, pgx.ErrNoRows):
		return err
	}
	return qs.InsertAttackAdherenceEvent(ctx, q.InsertAttackAdherenceEventParams{
		EnrollmentID: enrollment.ID, UserID: userID, ProgramID: "acute-med-timing",
		AttackID: &attackID, Signal: signal, Source: source, Payload: payload,
	})
}
