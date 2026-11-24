// Package acutemeds is src/services/acuteMedications: the MOH status
// counters and the acute medication report.
package acutemeds

import (
	"context"
	"slices"
	"sort"
	"time"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// Zone is the fixed zone both reports use.
const Zone = "Europe/Berlin"

// Classes is Object.values(MedicationClass) in declaration order.
var Classes = []string{"triptan", "ergotamine", "combination_analgesic", "opioid", "non_opioid_simple_analgesic"}

var thresholds = map[string]int{"triptan": 10, "ergotamine": 10, "combination_analgesic": 10, "opioid": 10, "non_opioid_simple_analgesic": 15}

func toStatus(used, threshold int) string {
	switch {
	case used >= threshold:
		return "exceeded"
	case float64(used) >= float64(threshold)*0.8:
		return "approaching"
	}
	return "ok"
}

func highest(levels ...string) string {
	if slices.Contains(levels, "exceeded") {
		return "exceeded"
	}
	if slices.Contains(levels, "approaching") {
		return "approaching"
	}
	return "ok"
}

func startOfMonth(t time.Time, loc *time.Location, offset int) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month()+time.Month(offset), 1, 0, 0, 0, 0, loc)
}

// DoseEvent is MohDoseEvent.
type DoseEvent struct {
	Class   string
	TakenAt time.Time
}

// MohStatus is getMOHStatus.
func MohStatus(ctx context.Context, qs *q.Queries, uid string, now time.Time, windowDays int) (*httpx.Object, error) {
	loc := tz.LoadOrUTC(Zone)
	rollingStart := localdate.StartOfDay(now, loc).AddDate(0, 0, -(max(1, windowDays) - 1))
	monthStart, monthEnd := startOfMonth(now, loc, 0), startOfMonth(now, loc, 1)
	from := min(rollingStart.UnixMilli(), monthStart.UnixMilli())
	rows, err := qs.MohDoseRows(ctx, uid, jsontime.New(time.UnixMilli(from)), jsontime.New(monthEnd))
	if err != nil {
		return nil, err
	}
	events := make([]DoseEvent, len(rows))
	for i, r := range rows {
		events[i] = DoseEvent{Class: r.MedicationClass, TakenAt: r.TakenAt.Time}
	}
	return ComputeMohStatus(events, now, Zone, windowDays), nil
}

// ComputeMohStatus is computeMohStatusFromEvents.
func ComputeMohStatus(events []DoseEvent, now time.Time, zone string, windowDays int) *httpx.Object {
	loc := tz.LoadOrUTC(zone)
	nowLocal := now.In(loc)
	today := localdate.String(now, zone)
	rollingFrom := localdate.StartOfDay(now, loc).AddDate(0, 0, -(max(1, windowDays) - 1)).Format(localdate.Layout)
	monthFrom := startOfMonth(now, loc, 0).Format(localdate.Layout)
	monthTo := startOfMonth(now, loc, 1).AddDate(0, 0, -1).Format(localdate.Layout)

	rolling, month := map[string]map[string]bool{}, map[string]map[string]bool{}
	for _, c := range Classes {
		rolling[c], month[c] = map[string]bool{}, map[string]bool{}
	}
	rollingMulti, monthMulti := map[string]bool{}, map[string]bool{}
	for _, e := range events {
		d := localdate.String(e.TakenAt, zone)
		if d >= rollingFrom && d <= today {
			if set, ok := rolling[e.Class]; ok {
				set[d] = true
			}
			rollingMulti[d] = true
		}
		if d >= monthFrom && d <= monthTo {
			if set, ok := month[e.Class]; ok {
				set[d] = true
			}
			monthMulti[d] = true
		}
	}
	perClass := make([]any, 0, len(Classes))
	var statuses []string
	for _, c := range Classes {
		r, m, th := len(rolling[c]), len(month[c]), thresholds[c]
		st := highest(toStatus(r, th), toStatus(m, th))
		statuses = append(statuses, st)
		perClass = append(perClass, httpx.O("medicationClass", c, "rolling30DaysUsed", r, "calendarMonthDaysUsed", m,
			"threshold", th, "status", st))
	}
	multi := highest(toStatus(len(rollingMulti), 10), toStatus(len(monthMulti), 10))
	return httpx.O("timezone", zone, "asOf", luxon.ToISO(nowLocal, loc), "rollingWindowDays", windowDays,
		"perClass", perClass,
		"multiClass", httpx.O("rolling30DaysUsed", len(rollingMulti), "calendarMonthDaysUsed", len(monthMulti),
			"threshold", 10, "status", multi),
		"status", highest(append(statuses, multi)...),
		"message", "Acute medication use may increase risk of medication-overuse headache; discuss with your clinician.")
}

type num float64

func (n num) MarshalJSON() ([]byte, error) { return []byte(jsx.FormatNumber(float64(n))), nil }

func median(values []float64) any {
	if len(values) == 0 {
		return nil
	}
	s := append([]float64{}, values...)
	sort.Float64s(s)
	mid := len(s) / 2
	if len(s)%2 == 1 {
		return num(s[mid])
	}
	return num((s[mid-1] + s[mid]) / 2)
}

// Report is getAcuteMedsReport. mode is rolling30 or calendarMonth.
func Report(ctx context.Context, qs *q.Queries, uid, mode string, now time.Time) (*httpx.Object, error) {
	loc := tz.LoadOrUTC(Zone)
	var from, toExcl time.Time
	if mode == "calendarMonth" {
		from, toExcl = startOfMonth(now, loc, 0), startOfMonth(now, loc, 1)
	} else {
		day := localdate.StartOfDay(now, loc)
		from = time.Date(day.Year(), day.Month(), day.Day()-29, 0, 0, 0, 0, loc)
		toExcl = time.Date(day.Year(), day.Month(), day.Day()+1, 0, 0, 0, 0, loc)
	}
	rows, err := qs.AcuteReportRows(ctx, uid, jsontime.New(from), jsontime.New(toExcl))
	if err != nil {
		return nil, err
	}
	var order []string
	byMed := map[string][]q.AcuteReportRowsRow{}
	for _, r := range rows {
		if _, ok := byMed[r.MedicationID]; !ok {
			order = append(order, r.MedicationID)
		}
		byMed[r.MedicationID] = append(byMed[r.MedicationID], r)
	}
	label := func(r q.AcuteReportRowsRow) string {
		// `customName || canonicalName || 'Medication'`
		if r.CustomName != nil && *r.CustomName != "" {
			return *r.CustomName
		}
		if r.CanonicalName != nil && *r.CanonicalName != "" {
			return *r.CanonicalName
		}
		return "Medication"
	}
	type med struct {
		obj       *httpx.Object
		usageDays int
	}
	var meds []med
	for _, id := range order {
		dose := byMed[id]
		days := map[string]bool{}
		outcomes, successes := 0, 0
		var relief []float64
		times := make([]int64, len(dose))
		for i, r := range dose {
			days[localdate.String(r.TakenAt.Time, Zone)] = true
			if r.Helped != nil {
				outcomes++
				if *r.Helped == "yes" {
					successes++
				}
			}
			if r.TimeToReliefMinutes != nil {
				relief = append(relief, float64(*r.TimeToReliefMinutes))
			}
			times[i] = r.TakenAt.UnixMilli()
		}
		slices.Sort(times)
		second := 0
		for i := 0; i < len(times)-1; i++ {
			if d := times[i+1] - times[i]; d >= 0 && d <= 24*60*60*1000 {
				second++
			}
		}
		var success any
		if outcomes > 0 {
			success = num(float64(successes) / float64(outcomes))
		}
		meds = append(meds, med{httpx.O("medicationId", id, "medicationLabel", label(dose[0]), "medicationClass", dose[0].MedicationClass,
			"usageDays", len(days), "doses", len(dose), "successRate", success, "medianTimeToReliefMinutes", median(relief),
			"needingSecondDosePct", num(float64(second)/float64(len(dose)))), len(days)})
	}
	sort.SliceStable(meds, func(i, j int) bool { return meds[i].usageDays > meds[j].usageDays })

	var classOrder []string
	byClass := map[string]map[string]bool{}
	for _, r := range rows {
		if _, ok := byClass[r.MedicationClass]; !ok {
			classOrder = append(classOrder, r.MedicationClass)
			byClass[r.MedicationClass] = map[string]bool{}
		}
		byClass[r.MedicationClass][localdate.String(r.TakenAt.Time, Zone)] = true
	}
	sort.SliceStable(classOrder, func(i, j int) bool { return len(byClass[classOrder[i]]) > len(byClass[classOrder[j]]) })

	medList, classList := []any{}, []any{}
	for _, m := range meds {
		medList = append(medList, m.obj)
	}
	for _, c := range classOrder {
		classList = append(classList, httpx.O("medicationClass", c, "usageDays", len(byClass[c])))
	}
	lastDay := toExcl.AddDate(0, 0, -1)
	return httpx.O("mode", mode, "timezone", Zone,
		"range", httpx.O("from", from.In(loc).Format(localdate.Layout), "to", lastDay.In(loc).Format(localdate.Layout)),
		"medications", medList, "classes", classList), nil
}
