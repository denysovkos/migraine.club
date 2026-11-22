// Package tz resolves IANA time zone names the way Luxon did.
package tz

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	cacheMu sync.Mutex
	cache   = map[string]*time.Location{}
)

var fixedRe = regexp.MustCompile(`^(?i)utc([+-])(\d{1,2})(?::?(\d{2}))?$`)

// Load returns the zone for an IANA name, "UTC", or a fixed offset such as
// "UTC+2" / "UTC-05:30". ok is false for anything Luxon would reject.
func Load(name string) (*time.Location, bool) {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if loc, ok := cache[name]; ok {
		return loc, loc != nil
	}
	loc := load(name)
	cache[name] = loc
	return loc, loc != nil
}

func load(name string) *time.Location {
	switch strings.ToLower(name) {
	case "utc", "gmt", "z", "etc/utc", "etc/gmt":
		return time.UTC
	case "", "local":
		return nil
	}
	if m := fixedRe.FindStringSubmatch(name); m != nil {
		h, _ := strconv.Atoi(m[2])
		mins := 0
		if m[3] != "" {
			mins, _ = strconv.Atoi(m[3])
		}
		off := h*3600 + mins*60
		if m[1] == "-" {
			off = -off
		}
		return time.FixedZone(fmt.Sprintf("UTC%s%s", m[1], m[2]), off)
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil
	}
	return loc
}

// LoadOrUTC returns the zone, or UTC when the name is invalid.
func LoadOrUTC(name string) *time.Location {
	if loc, ok := Load(name); ok {
		return loc
	}
	return time.UTC
}

// Valid reports whether name is a zone Load accepts.
func Valid(name string) bool { _, ok := Load(name); return ok }
