package episodes

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
)

type treatmentDose struct {
	medicationID     string
	takenAt          time.Time
	helped           *string
	neededSecondDose bool
	neededRescue     bool
	obj              *httpx.Object
}

// TreatmentModel is getAttackTreatmentModel: the acute doses taken during an
// attack (or linked to it) with their outcomes and the second-dose / rescue
// flags.
func TreatmentModel(ctx context.Context, qs *q.Queries, attackID int32, now time.Time) (*httpx.Object, error) {
	empty := httpx.O("attackId", attackID, "doses", []any{}, "flags", httpx.O("anySecondDose", false, "anyRescue", false))
	attack, err := qs.GetEpisodeAnyUser(ctx, attackID)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, nil
	}
	if err != nil {
		return nil, err
	}
	end := now
	if !attack.IsOngoing && attack.EndTime != nil {
		end = attack.EndTime.Time
	}
	rows, err := qs.AttackDoses(ctx, attack.UserID, attack.StartTime, jsontime.New(end), &attackID)
	if err != nil {
		return nil, err
	}
	doses := make([]*treatmentDose, len(rows))
	for i, r := range rows {
		label := "Medication"
		switch {
		case r.MedicationLabel != nil && *r.MedicationLabel != "":
			label = *r.MedicationLabel
		case r.CanonicalName != nil && *r.CanonicalName != "":
			label = *r.CanonicalName
		}
		var outcome any
		if r.OutcomeHelped != nil && *r.OutcomeHelped != "" {
			updated := jsontime.Format(r.TakenAt.Time)
			if r.OutcomeUpdatedAt != nil {
				updated = jsontime.Format(r.OutcomeUpdatedAt.Time)
			}
			outcome = httpx.O(
				"helped", *r.OutcomeHelped,
				"backToNormalFunction", r.BackToNormalFunction,
				"timeToReliefMinutes", r.TimeToReliefMinutes,
				"notes", r.OutcomeNotes,
				"updatedAt", updated)
		}
		doses[i] = &treatmentDose{medicationID: r.MedicationID, takenAt: r.TakenAt.Time, helped: r.OutcomeHelped,
			obj: httpx.O(
				"doseId", r.DoseID, "medicationId", r.MedicationID, "medicationLabel", label,
				"medicationClass", r.MedicationClass, "takenAt", jsontime.Format(r.TakenAt.Time),
				"dose", r.Dose, "unit", r.Unit, "unitIsCustom", r.UnitIsCustom, "notes", r.Notes,
				"outcome", outcome)}
	}

	byMed := map[string][]*treatmentDose{}
	var order []string
	for _, d := range doses {
		if _, ok := byMed[d.medicationID]; !ok {
			order = append(order, d.medicationID)
		}
		byMed[d.medicationID] = append(byMed[d.medicationID], d)
	}
	for _, id := range order {
		g := byMed[id]
		for i := 0; i < len(g)-1; i++ {
			delta := g[i+1].takenAt.Sub(g[i].takenAt)
			if delta >= 0 && delta <= 24*time.Hour {
				g[i].neededSecondDose = true
			}
		}
	}
	anySecond, anyRescue := false, false
	out := make([]any, len(doses))
	for i, d := range doses {
		later := false
		for _, l := range doses[i+1:] {
			if l.medicationID != d.medicationID {
				later = true
			}
		}
		low := d.helped != nil && (*d.helped == "no" || *d.helped == "partly")
		d.neededRescue = later && low
		d.obj.Set("neededSecondDose", d.neededSecondDose)
		d.obj.Set("neededRescue", d.neededRescue)
		anySecond = anySecond || d.neededSecondDose
		anyRescue = anyRescue || d.neededRescue
		out[i] = d.obj
	}
	return httpx.O("attackId", attackID, "doses", out, "flags", httpx.O("anySecondDose", anySecond, "anyRescue", anyRescue)), nil
}
