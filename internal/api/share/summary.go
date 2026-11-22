package share

import (
	"sort"
	"time"

	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// counter is a plain JS object used as a tally: Object.entries order, then
// a stable sort by count.
type counter struct {
	keys   []string
	counts map[string]int
}

func newCounter() *counter { return &counter{counts: map[string]int{}} }

func (c *counter) add(k string) {
	if _, ok := c.counts[k]; !ok {
		c.keys = append(c.keys, k)
	}
	c.counts[k]++
}

// top is Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null.
func (c *counter) top() any {
	keys := jsx.OwnKeys(c.keys)
	sort.SliceStable(keys, func(i, j int) bool { return c.counts[keys[i]] > c.counts[keys[j]] })
	if len(keys) == 0 || keys[0] == "" {
		return nil
	}
	return keys[0]
}

func intensityNumber(v any) (float64, bool) {
	switch x := v.(type) {
	case int32:
		return float64(x), true
	case int:
		return float64(x), true
	}
	return 0, false
}

// localDate is new Date(y, m, d) on the server's local clock, with JS
// rollover of the day number.
func localDate(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.Local) }

// calculateSummary is the share route's calculateSummary; dates use the
// server's local time zone like the Node Date methods did.
func calculateSummary(eps []sharedEpisode, nowUTC time.Time) *httpx.Object {
	if len(eps) == 0 {
		return httpx.O("totalEpisodes", 0, "episodesThisMonth", 0, "averageIntensity", 0,
			"averageDurationMinutes", nil, "mostCommonTrigger", nil, "mostCommonSymptom", nil,
			"mostCommonMedication", nil, "weeklyTrend", []any{})
	}
	now := nowUTC.In(time.Local)
	monthStart := localDate(now.Year(), now.Month(), 1)
	thisMonth := 0
	for _, e := range eps {
		if !e.start.Before(monthStart) {
			thisMonth++
		}
	}

	sum, n := 0.0, 0
	for _, e := range eps {
		if v, ok := intensityNumber(e.intensity); ok {
			sum += v
			n++
		}
	}
	avg := 0.0
	if n > 0 {
		avg = sum / float64(n)
	}

	var duration any
	total, completed := 0.0, 0
	for _, e := range eps {
		if e.end != nil && !e.ongoing {
			total += float64(e.end.UnixMilli() - e.start.UnixMilli())
			completed++
		}
	}
	if completed > 0 {
		duration = jsx.Round(total / float64(completed) / (1000 * 60))
	}

	triggers, symptoms, meds := newCounter(), newCounter(), newCounter()
	for _, e := range eps {
		for _, t := range e.triggers {
			triggers.add(jsx.ToPropertyKey(t))
		}
	}
	for _, e := range eps {
		for _, s := range e.symptoms {
			symptoms.add(jsx.ToPropertyKey(s))
		}
	}
	for _, e := range eps {
		for _, l := range e.medLabels {
			meds.add(l)
		}
	}

	trend := make([]any, 0, 8)
	for i := 7; i >= 0; i-- {
		// weekStart.setDate(getDate() - (i*7 + getDay())); setHours(0, 0, 0, 0)
		shifted := time.Date(now.Year(), now.Month(), now.Day()-(i*7+int(now.Weekday())),
			now.Hour(), now.Minute(), now.Second(), now.Nanosecond(), time.Local)
		weekStart := localDate(shifted.Year(), shifted.Month(), shifted.Day())
		weekEnd := localDate(weekStart.Year(), weekStart.Month(), weekStart.Day()+7)
		count, wsum, wn := 0, 0.0, 0
		for _, e := range eps {
			if !e.start.Before(weekStart) && e.start.Before(weekEnd) {
				count++
				if v, ok := intensityNumber(e.intensity); ok {
					wsum += v
					wn++
				}
			}
		}
		weekAvg := 0.0
		if count > 0 {
			weekAvg = jsx.Round(wsum/float64(max(1, wn))*10) / 10
		}
		trend = append(trend, httpx.O("week", weekStart.UTC().Format("2006-01-02"), "count", count, "avgIntensity", weekAvg))
	}

	return httpx.O("totalEpisodes", len(eps), "episodesThisMonth", thisMonth,
		"averageIntensity", jsx.Round(avg*10)/10, "averageDurationMinutes", duration,
		"mostCommonTrigger", triggers.top(), "mostCommonSymptom", symptoms.top(),
		"mostCommonMedication", meds.top(), "weeklyTrend", trend)
}
