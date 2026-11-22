// Package jsontime holds the date and time types that make Go JSON match what
// the previous Node.js API produced.
//
// Drizzle returned timestamp columns as JavaScript Date objects, which
// JSON.stringify writes with Date.prototype.toISOString: always UTC, always
// exactly three fractional digits, always a trailing "Z". Postgres stores
// microseconds, so the extra precision is truncated, never rounded, just like
// `new Date()` does when node-postgres parses the value.
//
// `date` columns declared with mode 'date' were also Dates (UTC midnight), so
// they serialise the same way. `date` columns in string mode stay plain
// "YYYY-MM-DD" strings and need no special type.
package jsontime

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ISOLayout is the layout of Date.prototype.toISOString.
const ISOLayout = "2006-01-02T15:04:05.000Z"

// Format renders t exactly like JavaScript's toISOString.
func Format(t time.Time) string {
	return t.UTC().Truncate(time.Millisecond).Format(ISOLayout)
}

// Parse accepts the same inputs `new Date(string)` accepts for ISO strings that
// the API receives: RFC 3339 with or without fractional seconds and offset.
// Date-only strings are UTC midnight, as in JavaScript.
func Parse(s string) (time.Time, error) {
	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02T15:04:05.999999999",
		"2006-01-02T15:04Z07:00",
		"2006-01-02T15:04",
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("jsontime: invalid date %q", s)
}

// Time is a timestamp that marshals like a JavaScript Date.
type Time struct{ time.Time }

// New wraps t, normalised to UTC.
func New(t time.Time) Time { return Time{t.UTC()} }

// Ptr wraps t into a pointer, for nullable columns.
func Ptr(t time.Time) *Time { v := New(t); return &v }

func (t Time) MarshalJSON() ([]byte, error) {
	if t.IsZero() {
		return []byte("null"), nil
	}
	return []byte(`"` + Format(t.Time) + `"`), nil
}

func (t *Time) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	parsed, err := Parse(s)
	if err != nil {
		return err
	}
	t.Time = parsed
	return nil
}

// Scan truncates to milliseconds: node-postgres handed the Node code JS
// Dates, so every comparison and computation the ported logic does must see
// millisecond values too.
func (t *Time) Scan(src any) error {
	switch v := src.(type) {
	case time.Time:
		t.Time = v.UTC().Truncate(time.Millisecond)
		return nil
	case nil:
		t.Time = time.Time{}
		return nil
	default:
		return fmt.Errorf("jsontime: cannot scan %T into Time", src)
	}
}

// Value always hands Postgres a UTC time, so `timestamp without time zone`
// columns store UTC wall-clock values exactly like Drizzle did.
func (t Time) Value() (driver.Value, error) {
	if t.IsZero() {
		return nil, nil
	}
	return t.UTC(), nil
}

// Date is a `date` column read in Drizzle's 'date' mode: a Date at UTC midnight.
type Date struct{ time.Time }

func NewDate(t time.Time) Date {
	y, m, d := t.Date()
	return Date{time.Date(y, m, d, 0, 0, 0, 0, time.UTC)}
}

func (d Date) MarshalJSON() ([]byte, error) {
	if d.IsZero() {
		return []byte("null"), nil
	}
	return []byte(`"` + Format(d.Time) + `"`), nil
}

func (d *Date) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	parsed, err := Parse(s)
	if err != nil {
		return err
	}
	d.Time = parsed
	return nil
}

func (d *Date) Scan(src any) error {
	switch v := src.(type) {
	case time.Time:
		y, m, day := v.Date()
		d.Time = time.Date(y, m, day, 0, 0, 0, 0, time.UTC)
		return nil
	case nil:
		d.Time = time.Time{}
		return nil
	default:
		return fmt.Errorf("jsontime: cannot scan %T into Date", src)
	}
}

func (d Date) Value() (driver.Value, error) {
	if d.IsZero() {
		return nil, nil
	}
	return d.Format("2006-01-02"), nil
}

// YMD is the "YYYY-MM-DD" form used by string-mode date columns.
func (d Date) YMD() string { return d.Format("2006-01-02") }

// YMD is a `date` column in Drizzle's string mode: "YYYY-MM-DD".
type YMD string

func (d *YMD) Scan(src any) error {
	switch v := src.(type) {
	case time.Time:
		*d = YMD(v.Format("2006-01-02"))
	case string:
		*d = YMD(v)
	case nil:
		*d = ""
	default:
		return fmt.Errorf("jsontime: cannot scan %T into YMD", src)
	}
	return nil
}

func (d YMD) Value() (driver.Value, error) { return string(d), nil }

// Clock is a `time` column: "HH:MM:SS", as node-postgres returned it.
type Clock string

// pgText trims the fractional part the way Postgres prints time values:
// "12:30:00.000000" is "12:30:00", "12:30:00.500000" is "12:30:00.5".
func pgText(s string) string {
	if i := strings.IndexByte(s, '.'); i >= 0 {
		frac := strings.TrimRight(s[i+1:], "0")
		if frac == "" {
			return s[:i]
		}
		return s[:i+1] + frac
	}
	return s
}

func (c *Clock) Scan(src any) error {
	switch v := src.(type) {
	case string:
		*c = Clock(pgText(v))
	case []byte:
		*c = Clock(pgText(string(v)))
	case time.Time:
		*c = Clock(v.Format("15:04:05"))
	case nil:
		*c = ""
	default:
		return fmt.Errorf("jsontime: cannot scan %T into Clock", src)
	}
	return nil
}

func (c Clock) Value() (driver.Value, error) { return string(c), nil }
