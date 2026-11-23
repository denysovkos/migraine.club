// Package spaceweather collects the planetary Kp index (geomagnetic
// activity) from NOAA, GFZ and NASA, stores it, and serves an aggregate.
// It is src/server/spaceWeather/kp.core.ts plus SpaceWeatherKpRepository.
package spaceweather

import (
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// Reading is KpReading. Raw and Meta are arbitrary JSON.
type Reading struct {
	Provider  string
	Value     float64
	Timestamp time.Time
	Stale     bool
	Raw       any
	Meta      any
}

// Storm is the last geomagnetic storm reported by GFZ.
type Storm struct {
	StartTime, EndTime time.Time
	PeakKp             float64
	PeakTime           time.Time
}

// Aggregate is KpAggregate. Optional numbers are nil when absent.
type Aggregate struct {
	AvgKp        *float64
	SourcesUsed  int
	Readings     []Reading
	ComputedAt   time.Time
	MinKp, MaxKp *float64
	Spread       *float64
	NoaaScale    *string
	LastStorm    *Storm
	Error        *string
}

var tzSuffix = regexp.MustCompile(`(?i)(?:z|[+-]\d{2}:?\d{2})$`)

// ParseUTCAssumeZ is parseUtcTimestampAssumeZ: timestamps without a zone are
// UTC; a space separator is accepted.
func ParseUTCAssumeZ(v any) (time.Time, bool) {
	s, ok := v.(string)
	if !ok {
		return time.Time{}, false
	}
	t := jsx.Trim(s)
	if t == "" {
		return time.Time{}, false
	}
	t = strings.Replace(t, " ", "T", 1)
	if !tzSuffix.MatchString(t) {
		t += "Z"
	}
	// JS accepts "+0200" as well as "+02:00".
	if m := regexp.MustCompile(`([+-]\d{2})(\d{2})$`).FindStringSubmatchIndex(t); m != nil && !strings.Contains(t[m[0]:], ":") {
		t = t[:m[3]] + ":" + t[m[3]:]
	}
	parsed, err := jsontime.Parse(t)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

// OlderThanMinutes is isOlderThanMinutes.
func OlderThanMinutes(now, ts time.Time, minutes float64) bool {
	return float64(now.Sub(ts).Milliseconds()) > minutes*60*1000
}

func numberOrParse(v any) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	if v == nil {
		return jsx.ParseFloat("")
	}
	return jsx.ParseFloat(jsx.String(v))
}

func finite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

// ComputeAggregate is computeAggregateFromReadings.
func ComputeAggregate(computedAt time.Time, readings []Reading, noaaScale *string, last *Storm) Aggregate {
	var values []float64
	for _, r := range readings {
		if !r.Stale && finite(r.Value) {
			values = append(values, r.Value)
		}
	}
	if readings == nil {
		readings = []Reading{}
	}
	if len(values) == 0 {
		msg := "Kp not available"
		return Aggregate{Readings: readings, ComputedAt: computedAt, NoaaScale: noaaScale, LastStorm: last, Error: &msg}
	}
	minV, maxV, sum := values[0], values[0], 0.0
	for _, v := range values {
		minV = math.Min(minV, v)
		maxV = math.Max(maxV, v)
		sum += v
	}
	avg := sum / float64(len(values))
	spread := maxV - minV
	return Aggregate{
		AvgKp: &avg, SourcesUsed: len(values), Readings: readings, ComputedAt: computedAt,
		MinKp: &minV, MaxKp: &maxV, Spread: &spread, NoaaScale: noaaScale, LastStorm: last,
	}
}

// ParseNoaa1m is parseNoaa1mPlanetaryKp.
func ParseNoaa1m(data any, now time.Time) *Reading {
	arr, ok := data.([]any)
	if !ok || len(arr) == 0 {
		return nil
	}
	last, _ := arr[len(arr)-1].(map[string]any)
	value := numberOrParse(get(last, "estimated_kp"))
	ts, ok := ParseUTCAssumeZ(get(last, "time_tag"))
	if !finite(value) || !ok {
		return nil
	}
	return &Reading{
		Provider: "noaa", Value: value, Timestamp: ts, Stale: OlderThanMinutes(now, ts, 20),
		Raw:  arr[len(arr)-1],
		Meta: httpx.O("sourceId", "noaa_1m", "kp_index", get(last, "kp_index")),
	}
}

func get(m map[string]any, k string) any {
	if m == nil {
		return nil
	}
	return m[k]
}

func indexOf(arr []any, s string) int {
	for i, v := range arr {
		if v == s {
			return i
		}
	}
	return -1
}

// ParseNoaaForecast is parseNoaaPlanetaryKIndexForecast.
func ParseNoaaForecast(data any, now time.Time) (*Reading, *string) {
	arr, ok := data.([]any)
	if !ok || len(arr) < 2 {
		return nil, nil
	}
	header, ok := arr[0].([]any)
	if !ok {
		return nil, nil
	}
	iTime, iKp, iObs, iScale := indexOf(header, "time_tag"), indexOf(header, "kp"), indexOf(header, "observed"), indexOf(header, "noaa_scale")
	if iTime == -1 || iKp == -1 || iObs == -1 {
		return nil, nil
	}
	at := func(row []any, i int) any {
		if i < 0 || i >= len(row) {
			return nil
		}
		return row[i]
	}
	var best *Reading
	var bestScale *string
	for _, rowAny := range arr[1:] {
		row, ok := rowAny.([]any)
		if !ok {
			continue
		}
		obs := strings.ToLower(nullishString(at(row, iObs)))
		if obs != "observed" && obs != "estimated" {
			continue
		}
		ts, ok := ParseUTCAssumeZ(at(row, iTime))
		if !ok || ts.After(now) {
			continue
		}
		value := jsx.ParseFloat(nullishString(at(row, iKp)))
		if !finite(value) {
			continue
		}
		var scale *string
		if iScale >= 0 && at(row, iScale) != nil {
			s := jsx.String(at(row, iScale))
			scale = &s
		}
		if best == nil || ts.After(best.Timestamp) {
			best = &Reading{Provider: "noaa", Value: value, Timestamp: ts, Raw: rowAny, Meta: httpx.O("sourceId", "noaa_forecast")}
			bestScale = scale
		}
	}
	if best == nil {
		return nil, nil
	}
	best.Stale = OlderThanMinutes(now, best.Timestamp, 6*60)
	return best, bestScale
}

// nullishString is String(v ?? ”).
func nullishString(v any) string {
	if v == nil {
		return ""
	}
	return jsx.String(v)
}

// ParseGfzWebservice is parseGfzWebserviceKp.
func ParseGfzWebservice(data any, now time.Time) *Reading {
	obj, _ := data.(map[string]any)
	datetimes, ok1 := get(obj, "datetime").([]any)
	kps, ok2 := get(obj, "Kp").([]any)
	if !ok1 || !ok2 || len(datetimes) == 0 || len(kps) == 0 || len(datetimes) != len(kps) {
		return nil
	}
	best := -1
	var bestTs time.Time
	for i := range datetimes {
		ts, ok := ParseUTCAssumeZ(datetimes[i])
		if !ok || ts.After(now) {
			continue
		}
		v, isNum := kps[i].(float64)
		if !isNum || !finite(v) {
			continue
		}
		if best == -1 || ts.After(bestTs) {
			best, bestTs = i, ts
		}
	}
	if best == -1 {
		return nil
	}
	value := kps[best].(float64)
	var status any
	if st, ok := get(obj, "status").([]any); ok && best < len(st) {
		status = st[best]
	}
	meta := httpx.O("sourceId", "gfz_webservice")
	if status != nil {
		meta = httpx.O("sourceId", "gfz_webservice", "status", status)
	}
	if m, ok := obj["meta"]; ok {
		meta.Set("meta", m)
	}
	return &Reading{Provider: "gfz", Value: value, Timestamp: bestTs, Stale: OlderThanMinutes(now, bestTs, 6*60), Raw: data, Meta: meta}
}

// ParseGfzNowcast is parseGfzNowcastKp.
func ParseGfzNowcast(data any, now time.Time) *Reading {
	arr, ok := data.([]any)
	if !ok || len(arr) == 0 {
		return nil
	}
	last, ok := arr[len(arr)-1].([]any)
	if !ok || len(last) < 2 {
		return nil
	}
	ms := jsx.ToNumber(last[0])
	value := numberOrParse(last[1])
	if !finite(ms) || !finite(value) {
		return nil
	}
	ts := time.UnixMilli(int64(ms)).UTC()
	return &Reading{Provider: "gfz", Value: value, Timestamp: ts, Stale: OlderThanMinutes(now, ts, 6*60), Raw: arr[len(arr)-1], Meta: httpx.O("sourceId", "gfz_nowcast")}
}

// ParseGfzLastStorm is parseGfzLastStorm.
func ParseGfzLastStorm(data any) *Storm {
	arr, ok := data.([]any)
	if !ok || len(arr) < 2 {
		return nil
	}
	type pair struct{ t, kp float64 }
	var pairs []pair
	for _, x := range arr {
		p, ok := x.([]any)
		if !ok || len(p) < 2 {
			continue
		}
		t, kp := jsx.ToNumber(p[0]), jsx.ToNumber(p[1])
		if finite(t) && finite(kp) {
			pairs = append(pairs, pair{t, kp})
		}
	}
	if len(pairs) < 2 {
		return nil
	}
	start := time.UnixMilli(int64(pairs[0].t)).UTC()
	end := time.UnixMilli(int64(pairs[len(pairs)-1].t)).UTC()
	peak := math.Inf(-1)
	peakTime := start
	for _, p := range pairs {
		if p.kp > peak {
			peak = p.kp
			peakTime = time.UnixMilli(int64(p.t)).UTC()
		}
	}
	if !finite(peak) {
		return nil
	}
	return &Storm{StartTime: start, EndTime: end, PeakKp: peak, PeakTime: peakTime}
}

// ParseNasaDonkiGst is parseNasaDonkiGst.
func ParseNasaDonkiGst(data any, now time.Time) *Reading {
	arr, ok := data.([]any)
	if !ok || len(arr) == 0 {
		return nil
	}
	var best *Reading
	for _, stormAny := range arr {
		storm, _ := stormAny.(map[string]any)
		all, ok := get(storm, "allKpIndex").([]any)
		if !ok {
			continue
		}
		for _, entryAny := range all {
			entry, _ := entryAny.(map[string]any)
			ts, ok := ParseUTCAssumeZ(get(entry, "observedTime"))
			if !ok || ts.After(now) {
				continue
			}
			value := numberOrParse(get(entry, "kpIndex"))
			if !finite(value) {
				continue
			}
			if best == nil || ts.After(best.Timestamp) {
				meta := httpx.O("sourceId", "nasa_donki_gst")
				if src, ok := entry["source"]; ok {
					meta.Set("entrySource", src)
				}
				best = &Reading{Provider: "nasa", Value: value, Timestamp: ts,
					Raw: httpx.O("storm", stormAny, "entry", entryAny), Meta: meta}
			}
		}
	}
	if best == nil {
		return nil
	}
	best.Stale = OlderThanMinutes(now, best.Timestamp, 24*60)
	return best
}
