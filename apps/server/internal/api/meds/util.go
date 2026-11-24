package meds

import (
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
)

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func qUpsertDoseOutcome(uid, doseID, helped string, back *bool, ttr *int32, notes *string, now time.Time) q.UpsertDoseOutcomeParams {
	return q.UpsertDoseOutcomeParams{
		UserID: uid, DoseID: doseID, Helped: helped, BackToNormalFunction: back,
		TimeToReliefMinutes: ttr, Notes: notes, Now: jsontime.New(now),
	}
}
