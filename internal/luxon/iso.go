// Package luxon reproduces the parts of Luxon 3 the Node services relied on
// for user-supplied input: DateTime.fromISO with a zone option, including its
// validation and DST resolution, so the same strings are accepted, rejected
// and resolved to the same instants.
package luxon

import (
	"math"
	"regexp"
	"strconv"
	"time"

	"github.com/denysovkos/migraine.club/internal/tz"
)

// Patterns from luxon/src/impl/regexParser.js, anchored like combineRegexes.
const (
	ianaSrc       = `[A-Za-z_+-]{1,256}(?::?/[A-Za-z0-9_+-]{1,256}(?:/[A-Za-z0-9_+-]{1,256})?)?`
	offsetSrc     = `(?:([Zz])|([+-]\d\d)(?::?(\d\d))?)`
	extZoneSrc    = `(?:` + offsetSrc + `?(?:\[(` + ianaSrc + `)\])?)?`
	timeBaseSrc   = `(\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d{1,30}))?)?)?`
	timeSrc       = timeBaseSrc + extZoneSrc
	timeExtSrc    = `(?:[Tt]` + timeSrc + `)?`
	ymdSrc        = `([+-]\d{6}|\d{4})(?:-?(\d\d)(?:-?(\d\d))?)?`
	weekSrc       = `(\d{4})-?W(\d\d)(?:-?(\d))?`
	ordinalSrc    = `(\d{4})-?(\d{3})`
	maxEpochMilli = 8.64e15
)

var (
	ymdRe     = regexp.MustCompile(`^` + ymdSrc + timeExtSrc + `$`)
	weekRe    = regexp.MustCompile(`^` + weekSrc + timeExtSrc + `$`)
	ordinalRe = regexp.MustCompile(`^` + ordinalSrc + timeExtSrc + `$`)
	timeRe    = regexp.MustCompile(`^` + timeSrc + `$`)
)

// fields is the object the extractors build; nil means undefined.
type fields struct {
	year, month, day                  *int
	weekYear, weekNumber, weekday     *int
	ordinal                           *int
	hour, minute, second, millisecond *int
}

func intp(v int) *int { return &v }

// parseInteger is util.parseInteger: undefined for "", parseInt otherwise.
func parseInteger(s string) *int {
	if s == "" {
		return nil
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return nil
	}
	return &n
}

func intOr(s string, fallback *int) *int {
	if s == "" {
		return fallback
	}
	return parseInteger(s)
}

// zoneSpec is the zone an ISO string named: a fixed offset or an IANA name.
type zoneSpec struct {
	loc *time.Location
	bad bool
}

// extractTime reads hours..ms, the offset and the bracketed zone starting at
// group c, returning the zone the string named (nil when none).
func extractTime(m []string, c int, f *fields) *zoneSpec {
	f.hour = intOr(m[c], intp(0))
	f.minute = intOr(m[c+1], intp(0))
	f.second = intOr(m[c+2], intp(0))
	if frac := m[c+3]; frac != "" {
		v, _ := strconv.ParseFloat("0."+frac, 64)
		f.millisecond = intp(int(math.Floor(v * 1000)))
	}
	var zone *zoneSpec
	if m[c+4] != "" || m[c+5] != "" {
		zone = &zoneSpec{loc: time.FixedZone("", signedOffset(m[c+5], m[c+6])*60)}
	}
	if name := m[c+7]; name != "" {
		loc, ok := tz.Load(name)
		zone = &zoneSpec{loc: loc, bad: !ok}
	}
	return zone
}

// signedOffset is util.signedOffset in minutes, keeping "-00:30" negative.
func signedOffset(h, mm string) int {
	hour, err := strconv.Atoi(h)
	if err != nil {
		hour = 0
	}
	mins, _ := strconv.Atoi(mm)
	if hour < 0 || (hour == 0 && len(h) > 0 && h[0] == '-') {
		mins = -mins
	}
	return hour*60 + mins
}

func parseISO(s string) (fields, *zoneSpec, bool) {
	var f fields
	if m := ymdRe.FindStringSubmatch(s); m != nil {
		f.year = parseInteger(m[1])
		f.month = intOr(m[2], intp(1))
		f.day = intOr(m[3], intp(1))
		return f, extractTime(m, 4, &f), true
	}
	if m := weekRe.FindStringSubmatch(s); m != nil {
		f.weekYear, f.weekNumber, f.weekday = parseInteger(m[1]), parseInteger(m[2]), parseInteger(m[3])
		return f, extractTime(m, 4, &f), true
	}
	if m := ordinalRe.FindStringSubmatch(s); m != nil {
		f.year, f.ordinal = parseInteger(m[1]), parseInteger(m[2])
		return f, extractTime(m, 3, &f), true
	}
	if m := timeRe.FindStringSubmatch(s); m != nil {
		return f, extractTime(m, 1, &f), true
	}
	return f, nil, false
}

// FromISO is DateTime.fromISO(s, { zone: loc }) at the given now. ok is false
// where Luxon returned an invalid DateTime (whose toISODate() is null). The
// result is in loc.
func FromISO(s string, loc *time.Location, now time.Time) (time.Time, bool) {
	f, zone, matched := parseISO(s)
	if !matched {
		return time.Time{}, false
	}
	interp := loc
	if zone != nil {
		if zone.bad {
			return time.Time{}, false
		}
		interp = zone.loc
	}
	t, ok := fromObject(f, interp, now)
	if !ok {
		return time.Time{}, false
	}
	return t.In(loc), true
}

// offsetSec is IANAZone.offset at the instant, in seconds (Luxon's
// fractional minutes keep LMT seconds exact). ok is false where Luxon got NaN:
// the instant or its wall-clock time falls outside the JS Date range.
func offsetSec(loc *time.Location, ms int64) (int, bool) {
	if math.Abs(float64(ms)) > maxEpochMilli {
		return 0, false
	}
	_, off := time.UnixMilli(ms).In(loc).Zone()
	if math.Abs(float64(ms+int64(off)*1000)) > maxEpochMilli {
		return 0, false
	}
	return off, true
}

// fromObject is DateTime.fromObject's defaulting, validation and objToTS.
func fromObject(f fields, loc *time.Location, now time.Time) (time.Time, bool) {
	provis, _ := offsetSec(loc, now.UnixMilli())
	nowObj := time.UnixMilli(now.UnixMilli() + int64(provis)*1000).UTC()

	useWeek := f.weekYear != nil || f.weekNumber != nil
	hasOrdinal := f.ordinal != nil
	ms := f.millisecond
	if ms == nil {
		ms = intp(0)
	}
	if f.hour == nil {
		// Time-only input: the date comes from now in the zone.
		f.hour, f.minute, f.second = intp(0), intp(0), intp(0)
	}
	if f.year == nil && !useWeek && !hasOrdinal {
		f.year, f.month, f.day = intp(nowObj.Year()), intp(int(nowObj.Month())), intp(nowObj.Day())
	}
	if useWeek && f.weekday == nil {
		f.weekday = intp(1)
	}

	h, mi, se, mil := *f.hour, *f.minute, *f.second, *ms
	timeOK := ((h >= 0 && h <= 23) || (h == 24 && mi == 0 && se == 0 && mil == 0)) &&
		mi >= 0 && mi <= 59 && se >= 0 && se <= 59 && mil >= 0 && mil <= 999

	var y, mo, d int
	switch {
	case useWeek:
		wy, wn, wd := *f.weekYear, *f.weekNumber, *f.weekday
		if wn < 1 || wn > weeksInWeekYear(wy) || wd < 1 || wd > 7 || !timeOK {
			return time.Time{}, false
		}
		jan4 := time.Date(wy, 1, 4, 0, 0, 0, 0, time.UTC)
		monday := jan4.AddDate(0, 0, -(isoWeekday(jan4) - 1))
		g := monday.AddDate(0, 0, (wn-1)*7+wd-1)
		y, mo, d = g.Year(), int(g.Month()), g.Day()
	case hasOrdinal:
		yy, od := *f.year, *f.ordinal
		if od < 1 || od > daysInYear(yy) || !timeOK {
			return time.Time{}, false
		}
		g := time.Date(yy, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, od-1)
		y, mo, d = g.Year(), int(g.Month()), g.Day()
	default:
		y, mo, d = *f.year, *f.month, *f.day
		if mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || !timeOK {
			return time.Time{}, false
		}
	}

	local := time.Date(y, time.Month(mo), d, h, mi, se, mil*int(time.Millisecond), time.UTC).UnixMilli()
	if math.Abs(float64(local)) > maxEpochMilli {
		return time.Time{}, false
	}
	ts, ok := fixOffset(local, provis, loc)
	if !ok || math.Abs(float64(ts)) > maxEpochMilli {
		return time.Time{}, false
	}
	return time.UnixMilli(ts), true
}

// fixOffset is Luxon's DST resolution for a wall-clock time. A NaN offset
// makes the result NaN (ok false).
func fixOffset(localTS int64, o int, loc *time.Location) (int64, bool) {
	utcGuess := localTS - int64(o)*1000
	o2, ok := offsetSec(loc, utcGuess)
	if !ok {
		return 0, false
	}
	if o == o2 {
		return utcGuess, true
	}
	utcGuess -= int64(o2-o) * 1000
	o3, ok := offsetSec(loc, utcGuess)
	if !ok {
		return 0, false
	}
	if o2 == o3 {
		return utcGuess, true
	}
	return localTS - int64(min(o2, o3))*1000, true
}

func isoWeekday(t time.Time) int {
	if wd := int(t.Weekday()); wd != 0 {
		return wd
	}
	return 7
}

func isLeap(y int) bool { return y%4 == 0 && (y%100 != 0 || y%400 == 0) }

func daysInYear(y int) int {
	if isLeap(y) {
		return 366
	}
	return 365
}

func daysIn(y, m int) int {
	return time.Date(y, time.Month(m)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func weeksInWeekYear(y int) int {
	_, w := time.Date(y, 12, 28, 0, 0, 0, 0, time.UTC).ISOWeek()
	return w
}

// ISODate is toISODate(): YYYY-MM-DD, with Luxon's six-digit signed years
// outside 0..9999.
func ISODate(t time.Time) string {
	y := t.Year()
	var ys string
	switch {
	case y > 9999:
		ys = "+" + pad(y, 6)
	case y < 0:
		ys = "-" + pad(-y, 6)
	default:
		ys = pad(y, 4)
	}
	return ys + "-" + pad(int(t.Month()), 2) + "-" + pad(t.Day(), 2)
}

func pad(n, width int) string {
	s := strconv.Itoa(n)
	for len(s) < width {
		s = "0" + s
	}
	return s
}

// SetTime is dt.set({ hour, minute, second, millisecond }) for a DateTime in
// loc: the wall clock is replaced and resolved against dt's own offset, which
// is how Luxon picks a side of a DST change.
func SetTime(dt time.Time, loc *time.Location, hour, minute, second, ms int) (time.Time, bool) {
	l := dt.In(loc)
	_, off := l.Zone()
	local := time.Date(l.Year(), l.Month(), l.Day(), hour, minute, second, ms*int(time.Millisecond), time.UTC).UnixMilli()
	ts, ok := fixOffset(local, off, loc)
	if !ok || math.Abs(float64(ts)) > maxEpochMilli {
		return time.Time{}, false
	}
	return time.UnixMilli(ts).In(loc), true
}

// PlusDays is dt.plus({ days: n }) for a DateTime in loc: the wall clock moves
// by calendar days and is resolved against dt's offset.
func PlusDays(dt time.Time, loc *time.Location, n int) time.Time {
	l := dt.In(loc)
	_, off := l.Zone()
	local := time.Date(l.Year(), l.Month(), l.Day()+n, l.Hour(), l.Minute(), l.Second(), l.Nanosecond(), time.UTC).UnixMilli()
	ts, _ := fixOffset(local, off, loc)
	return time.UnixMilli(ts).In(loc)
}

// DiffDays is a.diff(b, 'days').days for a DateTime a in aLoc and b in bLoc,
// following Luxon's calendar-day algorithm with a fractional remainder.
func DiffDays(a time.Time, aLoc *time.Location, b time.Time, bLoc *time.Location) float64 {
	otherIsLater := b.UnixMilli() > a.UnixMilli()
	earlier, eLoc, later, lLoc := b, bLoc, a, aLoc
	if otherIsLater {
		earlier, eLoc, later, lLoc = a, aLoc, b, bLoc
	}
	dayStart := func(t time.Time, loc *time.Location) int64 {
		l := t.In(loc)
		return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC).UnixMilli()
	}
	days := int(math.Floor(float64(dayStart(later, lLoc)-dayStart(earlier, eLoc)) / 86400000))
	lms := later.UnixMilli()
	highWater := PlusDays(earlier, eLoc, days)
	var cursor time.Time
	same := false // highWater and cursor are the same DateTime object in Luxon
	if highWater.UnixMilli() > lms {
		days--
		cursor = PlusDays(earlier, eLoc, days)
		if cursor.UnixMilli() > lms {
			highWater = cursor
			days--
			cursor = PlusDays(earlier, eLoc, days)
		}
	} else {
		cursor, same = highWater, true
	}
	remaining := float64(lms - cursor.UnixMilli())
	if highWater.UnixMilli() < lms {
		highWater, same = PlusDays(cursor, eLoc, 1), false
	}
	result := float64(days)
	if !same {
		result += remaining / float64(highWater.UnixMilli()-cursor.UnixMilli())
	}
	if otherIsLater {
		result = -result
	}
	return result
}

// ToISO is DateTime#toISO() for t in loc: milliseconds and the offset, "Z"
// only for UTC itself (a fixed zero offset).
func ToISO(t time.Time, loc *time.Location) string {
	l := t.In(loc)
	_, off := l.Zone()
	base := ISODate(l) + "T" + pad(l.Hour(), 2) + ":" + pad(l.Minute(), 2) + ":" + pad(l.Second(), 2) + "." +
		pad(l.Nanosecond()/int(time.Millisecond), 3)
	if loc == time.UTC {
		return base + "Z"
	}
	sign := "+"
	if off < 0 {
		sign, off = "-", -off
	}
	return base + sign + pad(off/3600, 2) + ":" + pad(off%3600/60, 2)
}
