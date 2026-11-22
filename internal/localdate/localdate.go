// Package localdate is src/services/localDate.ts: calendar dates in the
// user's time zone.
package localdate

import (
	"time"

	"github.com/denysovkos/migraine.club/internal/tz"
)

// EditWindowDays is the diary editing window: the last 30 days including today.
const EditWindowDays = 30

// Layout is YYYY-MM-DD.
const Layout = "2006-01-02"

// String is toLocalDateString: the calendar date of t in the zone. An invalid
// zone falls back to UTC (the server's zone, which Luxon's default was).
func String(t time.Time, zone string) string {
	return t.In(tz.LoadOrUTC(zone)).Format(Layout)
}

// DBDate is toLocalDate / ymdToDbDate: the local date as UTC midnight.
func DBDate(t time.Time, zone string) time.Time {
	d, _ := time.Parse(Layout, String(t, zone))
	return d
}

// YMDToDBDate parses "YYYY-MM-DD" as UTC midnight.
func YMDToDBDate(ymd string) (time.Time, error) { return time.Parse(Layout, ymd) }

// StartOfDay is Luxon's startOf('day') in loc.
func StartOfDay(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, loc)
}

// ParseInZone is DateTime.fromISO(ymd, { zone }) for a date: local midnight.
func ParseInZone(ymd string, loc *time.Location) (time.Time, bool) {
	d, err := time.ParseInLocation(Layout, ymd, loc)
	if err != nil {
		return time.Time{}, false
	}
	return d, true
}

// IsEditable is isEditableLocalDate.
func IsEditable(ymd string, nowUTC time.Time, zone string) bool {
	loc, ok := tz.Load(zone)
	if !ok {
		return false
	}
	today := StartOfDay(nowUTC, loc)
	target, ok := ParseInZone(ymd, loc)
	if !ok {
		return false
	}
	earliest := today.AddDate(0, 0, -(EditWindowDays - 1))
	return !target.Before(earliest) && !target.After(today)
}

// Overlapped is getLocalDatesOverlappedByRange: the local dates a time range
// touches. A missing or non-positive range is its start day only; the end is
// exclusive, so ending exactly at midnight does not count the next day.
func Overlapped(start time.Time, end *time.Time, zone string) []string {
	loc := tz.LoadOrUTC(zone)
	s := start.In(loc)
	if end == nil || !end.After(start) {
		return []string{s.Format(Layout)}
	}
	e := end.Add(-time.Millisecond).In(loc)
	cur := time.Date(s.Year(), s.Month(), s.Day(), 0, 0, 0, 0, loc)
	last := time.Date(e.Year(), e.Month(), e.Day(), 0, 0, 0, 0, loc)
	var out []string
	for !cur.After(last) {
		out = append(out, cur.Format(Layout))
		cur = cur.AddDate(0, 0, 1)
	}
	return out
}

// UTCRange is toUtcRangeForLocalDatesInclusive: [start of the first date,
// start of the day after the last date) as UTC instants.
func UTCRange(zone string, dates []string) (time.Time, time.Time) {
	loc := tz.LoadOrUTC(zone)
	minD, maxD := dates[0], dates[0]
	for _, d := range dates {
		if d < minD {
			minD = d
		}
		if d > maxD {
			maxD = d
		}
	}
	first, _ := ParseInZone(minD, loc)
	last, _ := ParseInZone(maxD, loc)
	end := last.AddDate(0, 0, 1)
	end = time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, loc)
	return first.UTC(), end.UTC()
}
