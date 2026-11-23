// Package outcomes is src/services/outcomes: migraine/headache day counts and
// responder status over a range of local dates.
package outcomes

import (
	"slices"
	"time"

	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
)

// DiaryDay is DiaryDayEntryLike.
type DiaryDay struct {
	LocalDate string
	DayType   string
}

// MedicationIntake is EpisodeMedicationLike; Name "" is undefined.
type MedicationIntake struct {
	TakenAt time.Time
	Name    string
}

// Coverage counts diary days in the range.
type Coverage struct {
	TotalDays    int `json:"totalDays"`
	RecordedDays int `json:"recordedDays"`
	MissingDays  int `json:"missingDays"`
}

// Totals is OutcomesTotals.
type Totals struct {
	MmdMin              int      `json:"mmdMin"`
	MmdMax              int      `json:"mmdMax"`
	MhdMin              int      `json:"mhdMin"`
	MhdMax              int      `json:"mhdMax"`
	AcuteMedicationDays int      `json:"acuteMedicationDays"`
	Coverage            Coverage `json:"coverage"`
}

// DailyPoint is OutcomesDailyPoint; DayType nil is a missing day.
type DailyPoint struct {
	Date           string   `json:"date"`
	DayType        *string  `json:"dayType"`
	TookMedication bool     `json:"tookMedication"`
	Medications    []string `json:"medications"`
}

// Result is computeOutcomesForRange's result.
type Result struct {
	WindowDays int          `json:"windowDays"`
	Timezone   string       `json:"timezone"`
	Totals     Totals       `json:"totals"`
	Daily      []DailyPoint `json:"daily"`
}

// ListLocalDatesInclusive is listLocalDatesInclusive for valid YYYY-MM-DD
// bounds: every calendar date from..to.
func ListLocalDatesInclusive(from, to string) []string {
	start, err1 := time.Parse(localdate.Layout, from)
	end, err2 := time.Parse(localdate.Layout, to)
	out := []string{}
	if err1 != nil || err2 != nil {
		return out
	}
	for cur := start; !cur.After(end); cur = cur.AddDate(0, 0, 1) {
		out = append(out, cur.Format(localdate.Layout))
	}
	return out
}

// ComputeForRange is computeOutcomesForRange.
func ComputeForRange(timezone string, windowDays int, from, to string, diaryDays []DiaryDay, intakes []MedicationIntake) Result {
	medicationDays := map[string]bool{}
	namesByDay := map[string][]string{}
	for _, m := range intakes {
		day := localdate.String(m.TakenAt, timezone)
		medicationDays[day] = true
		if name := jsx.Trim(m.Name); name != "" && !slices.Contains(namesByDay[day], name) {
			namesByDay[day] = append(namesByDay[day], name)
		}
	}
	diaryByDate := map[string]string{}
	for _, e := range diaryDays {
		diaryByDate[e.LocalDate] = e.DayType
	}

	days := ListLocalDatesInclusive(from, to)
	daily := make([]DailyPoint, 0, len(days))
	var t Totals
	for _, date := range days {
		p := DailyPoint{Date: date, TookMedication: medicationDays[date], Medications: []string{}}
		if dt, ok := diaryByDate[date]; ok {
			p.DayType = &dt
		}
		// `d.dayType ? 1 : 0`: an empty day type is not a recorded day.
		if dt := diaryByDate[date]; dt != "" {
			t.Coverage.RecordedDays++
			if dt == "headache_day" || dt == "migraine_day" {
				t.MhdMin++
			}
			if dt == "migraine_day" {
				t.MmdMin++
			}
		}
		if names := namesByDay[date]; len(names) > 0 {
			p.Medications = slices.SortedFunc(slices.Values(names), jsx.CompareUTF16)
		}
		if p.TookMedication {
			t.AcuteMedicationDays++
		}
		daily = append(daily, p)
	}
	t.Coverage.TotalDays = len(days)
	t.Coverage.MissingDays = t.Coverage.TotalDays - t.Coverage.RecordedDays
	t.MmdMax = t.MmdMin + t.Coverage.MissingDays
	t.MhdMax = t.MhdMin + t.Coverage.MissingDays
	return Result{WindowDays: windowDays, Timezone: timezone, Totals: t, Daily: daily}
}

// Responder50 is computeResponder50's status; the counts are set unless NA.
type Responder50 struct {
	Status      string
	BaselineMmd int
	CurrentMmd  int
}

// ComputeResponder50 is computeResponder50.
func ComputeResponder50(baselineMmd, currentMmd int) Responder50 {
	if baselineMmd == 0 {
		return Responder50{Status: "NA"}
	}
	status := "NO"
	if float64(currentMmd) <= float64(baselineMmd)*0.5 {
		status = "YES"
	}
	return Responder50{Status: status, BaselineMmd: baselineMmd, CurrentMmd: currentMmd}
}
