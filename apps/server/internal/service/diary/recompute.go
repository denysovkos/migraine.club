// Package diary keeps the daily diary consistent with attacks.
package diary

import (
	"context"
	"sort"
	"time"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
)

// TouchedDates is deriveTouchedLocalDatesForEpisode: an ongoing attack runs
// until now.
func TouchedDates(start time.Time, end *time.Time, ongoing bool, now time.Time, zone string) []string {
	if end == nil && ongoing {
		end = &now
	}
	return localdate.Overlapped(start, end, zone)
}

// StrongestDayType is strongestDayTypeFromAttacks ("" when no attack).
func StrongestDayType(migraine, headache bool) string {
	switch {
	case migraine:
		return "migraine_day"
	case headache:
		return "headache_day"
	}
	return ""
}

// Result is RecomputeResult.
type Result struct {
	Timezone      string
	AffectedDates []string
}

// Recompute is recomputeDayRowsForDates. zone "" means "look it up".
func Recompute(ctx context.Context, qs *q.Queries, userID string, dates []string, zone string, now time.Time) (Result, error) {
	if zone == "" {
		z, err := usertz.Get(ctx, qs, userID)
		if err != nil {
			return Result{}, err
		}
		zone = z
	}
	set := map[string]bool{}
	var local []string
	for _, d := range dates {
		if d != "" && !set[d] {
			set[d] = true
			local = append(local, d)
		}
	}
	sort.Strings(local)
	if len(local) == 0 {
		return Result{Timezone: zone, AffectedDates: []string{}}, nil
	}

	rangeStart, rangeEnd := localdate.UTCRange(zone, local)
	episodes, err := qs.EpisodesTouchingRange(ctx, userID, jsontime.New(rangeEnd), jsontime.Ptr(rangeStart))
	if err != nil {
		return Result{}, err
	}

	type flags struct{ migraine, headache bool }
	byDate := map[string]*flags{}
	for _, d := range local {
		byDate[d] = &flags{}
	}
	for _, ep := range episodes {
		var end *time.Time
		if ep.EndTime != nil {
			e := ep.EndTime.Time
			end = &e
		}
		for _, d := range TouchedDates(ep.StartTime.Time, end, ep.IsOngoing, now, zone) {
			f, ok := byDate[d]
			if !ok {
				continue
			}
			if ep.AttackType == "headache" {
				f.headache = true
			} else {
				f.migraine = true
			}
		}
	}

	ymds := make([]jsontime.YMD, len(local))
	for i, d := range local {
		ymds[i] = jsontime.YMD(d)
	}
	existingRows, err := qs.DiaryRowsForDates(ctx, userID, ymds)
	if err != nil {
		return Result{}, err
	}
	existing := map[string]q.DailyDiaryEntry{}
	for _, row := range existingRows {
		existing[row.LocalDate.YMD()] = row
	}

	for _, d := range local {
		f := byDate[d]
		desired := StrongestDayType(f.migraine, f.headache)
		row, has := existing[d]
		day, _ := localdate.YMDToDBDate(d)

		if desired != "" {
			createdFrom := "attack"
			if has && row.CreatedFrom == "user" {
				createdFrom = "user"
			}
			insertFrom := "attack"
			if has {
				insertFrom = createdFrom
			}
			if err := qs.UpsertAttackDiaryDay(ctx, q.UpsertAttackDiaryDayParams{
				UserID: userID, LocalDate: jsontime.NewDate(day), Timezone: zone, DayType: desired,
				InsertCreatedFrom: insertFrom, ConflictCreatedFrom: createdFrom, Now: jsontime.New(time.Now()),
			}); err != nil {
				return Result{}, err
			}
			continue
		}
		if !has || row.DayType == "headache_free" {
			continue
		}
		if row.CreatedFrom == "attack" {
			if err := qs.DeleteDiaryDay(ctx, userID, jsontime.NewDate(day)); err != nil {
				return Result{}, err
			}
		}
	}
	return Result{Timezone: zone, AffectedDates: local}, nil
}
