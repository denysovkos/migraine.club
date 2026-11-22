// Package insights is src/services/insights: the case-crossover trigger
// analysis (InsightsEngine), its cache and the test plans.
//
// The engine is ported operation for operation, including float evaluation
// order, V8's Math.log/Math.exp (jsx.Log/jsx.Exp) and JavaScript's stable
// sorts, so payloads match the Node service exactly; see engine_golden_test.go.
package insights

import (
	"math"
	"slices"
	"sort"
	"strconv"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// Config is InsightsEngineConfig.
type Config struct {
	MethodVersion             string
	WindowDays                int
	ControlsPerCase           int
	ControlGuardHours         float64
	MinCaseMoments            int
	MinDiaryDays              int
	MinAttackStarts           int
	HighConfidenceAttackStart int
	MinTotalExposures         int
	Alpha                     float64
	MaxHighlights             int
	MaxPerBucket              int
	EarlySignCloseHours       float64
	EarlySignShareThreshold   float64
}

// DefaultConfig is DEFAULT_INSIGHTS_ENGINE_CONFIG.
var DefaultConfig = Config{
	MethodVersion: "f39_v2_cc_wilson_bh_v1", WindowDays: 90, ControlsPerCase: 6, ControlGuardHours: 48,
	MinCaseMoments: 6, MinDiaryDays: 45, MinAttackStarts: 6, HighConfidenceAttackStart: 10, MinTotalExposures: 6,
	Alpha: 0.05, MaxHighlights: 3, MaxPerBucket: 12, EarlySignCloseHours: 2, EarlySignShareThreshold: 0.6,
}

// Episode is EpisodeStart (times in epoch ms).
type Episode struct {
	ID        int32
	StartMs   int64
	EndMs     *int64
	IsOngoing bool
}

// Factor is FactorInfo.
type Factor struct {
	ID, DisplayName, Type string
}

// FactorEvent is FactorEvent (occurredAt in epoch ms).
type FactorEvent struct {
	FactorID   string
	OccurredMs int64
}

// Num is a number that serializes like JSON.stringify.
type Num float64

// MarshalJSON writes Number.prototype.toString (so -0 is "0").
func (n Num) MarshalJSON() ([]byte, error) { return []byte(jsx.FormatNumber(float64(n))), nil }

// Interval is {low, high}.
type Interval struct {
	Low  Num `json:"low"`
	High Num `json:"high"`
}

// Counts is InsightCard.counts.
type Counts struct {
	SetsUsed          int `json:"setsUsed"`
	ControlsPerSetAvg Num `json:"controlsPerSetAvg"`
	CaseExposed       int `json:"caseExposed"`
	CaseTotal         int `json:"caseTotal"`
	ControlExposed    int `json:"controlExposed"`
	ControlTotal      int `json:"controlTotal"`
}

// Card is InsightCard.
type Card struct {
	ID                string   `json:"id"`
	FactorID          string   `json:"factorId"`
	FactorName        string   `json:"factorName"`
	FactorType        string   `json:"factorType"`
	Window            string   `json:"window"`
	Bucket            string   `json:"bucket"`
	Direction         string   `json:"direction"`
	CaseRate          Num      `json:"caseRate"`
	ControlRate       Num      `json:"controlRate"`
	RiskDiff          Num      `json:"riskDiff"`
	RiskDiffCi        Interval `json:"riskDiffCi"`
	PValue            Num      `json:"pValue"`
	QValue            Num      `json:"qValue"`
	Confidence        string   `json:"confidence"`
	PossibleEarlySign bool     `json:"possibleEarlySign"`
	Counts            Counts   `json:"counts"`
}

// Bucket is InsightsBucket.
type Bucket struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Items []Card `json:"items"`
}

// TrendPoint is InsightsTrendPoint.
type TrendPoint struct {
	WeekStart    string `json:"weekStart"`
	AttackStarts int    `json:"attackStarts"`
}

// Readiness is InsightsDataReadiness.
type Readiness struct {
	DiaryDaysRecorded int      `json:"diaryDaysRecorded"`
	DiaryDaysTotal    int      `json:"diaryDaysTotal"`
	DiaryCoveragePct  Num      `json:"diaryCoveragePct"`
	AttackStarts      int      `json:"attackStarts"`
	LastComputedAt    string   `json:"lastComputedAt"`
	Missing           []string `json:"missing"`
}

// Exclusions is InsightsInputStats.exclusions.
type Exclusions struct {
	EpisodesOutsideWindow     int `json:"episodesOutsideWindow"`
	FactorEventsDuringAttack  int `json:"factorEventsDuringAttack"`
	CandidateControlsRejected int `json:"candidateControlsRejected"`
}

// InputStats is InsightsInputStats.
type InputStats struct {
	WindowDays        int        `json:"windowDays"`
	NowUtc            string     `json:"nowUtc"`
	EpisodesInWindow  int        `json:"episodesInWindow"`
	CaseMomentsUsed   int        `json:"caseMomentsUsed"`
	DiaryDaysObserved int        `json:"diaryDaysObserved"`
	FactorsTested     int        `json:"factorsTested"`
	ControlsPerCase   int        `json:"controlsPerCase"`
	RuntimeMs         int64      `json:"runtimeMs"`
	Exclusions        Exclusions `json:"exclusions"`
}

// Trends is InsightsPayload.trends.
type Trends struct {
	WeeklyAttackStarts []TrendPoint `json:"weeklyAttackStarts"`
}

// Payload is InsightsPayload.
type Payload struct {
	MethodVersion string     `json:"methodVersion"`
	WindowDays    int        `json:"windowDays"`
	ComputedAt    string     `json:"computedAt"`
	Disclaimer    string     `json:"disclaimer"`
	Status        string     `json:"status"`
	DataReadiness Readiness  `json:"dataReadiness"`
	Highlights    []Card     `json:"highlights"`
	Buckets       []Bucket   `json:"buckets"`
	Trends        Trends     `json:"trends"`
	InputStats    InputStats `json:"inputStats"`
}

// Result is InsightsEngineResult; Reason is set for insufficient_data.
type Result struct {
	Status  string // ok | insufficient_data | no_strong_signals
	Reason  string
	Payload Payload
}

type windowSpec struct {
	id               string
	fromHours, toHrs float64
}

var windows = []windowSpec{{"0_12h", 0, 12}, {"12_24h", 12, 24}, {"24_48h", 24, 48}}

const hourMs = 60 * 60 * 1000

func msHours(h float64) int64 { return int64(h * hourMs) }

// rng is SeededRng (xorshift32).
type rng struct{ state int32 }

func newRng(seed int32) *rng {
	if seed == 0 {
		return &rng{0x1A2B3C4D}
	}
	return &rng{seed}
}

func (r *rng) nextUint32() uint32 {
	x := r.state
	x ^= x << 13
	x ^= int32(uint32(x) >> 17)
	x ^= x << 5
	r.state = x
	return uint32(x)
}

func (r *rng) intn(minIncl, maxIncl int) int {
	span := uint32(maxIncl - minIncl + 1)
	return minIncl + int(r.nextUint32()%span)
}

// hashStringToSeed32 is FNV-1a over UTF-16 code units, as an int32.
func hashStringToSeed32(s string) int32 {
	h := uint32(0x811C9DC5)
	for _, c := range utf16.Encode([]rune(s)) {
		h ^= uint32(c)
		h *= 0x01000193
	}
	return int32(h)
}

type attackWindow struct{ start, end int64 }

func buildAttackWindows(eps []Episode, now int64) []attackWindow {
	out := make([]attackWindow, len(eps))
	for i, ep := range eps {
		end := ep.StartMs
		switch {
		case ep.EndMs != nil:
			end = *ep.EndMs
		case ep.IsOngoing:
			end = now
		}
		out[i] = attackWindow{ep.StartMs, end}
	}
	return out
}

func withinAttack(ws []attackWindow, t int64) bool {
	for _, w := range ws {
		if t >= w.start && t <= w.end {
			return true
		}
	}
	return false
}

// lowerBound is the binary search the engine repeats: first index >= v.
func lowerBound(sorted []int64, v int64) int {
	return sort.Search(len(sorted), func(i int) bool { return sorted[i] >= v })
}

func startWithinGuard(sorted []int64, t int64, guardHours float64) bool {
	g := msHours(guardHours)
	i := lowerBound(sorted, t-g)
	return i < len(sorted) && sorted[i] <= t+g
}

func anyEventIn(sorted []int64, start, end int64) bool {
	if len(sorted) == 0 {
		return false
	}
	i := lowerBound(sorted, start)
	return i < len(sorted) && sorted[i] < end
}

func minLagHours(sorted []int64, start, end, onset int64) *float64 {
	if len(sorted) == 0 {
		return nil
	}
	var best *float64
	for i := lowerBound(sorted, start); i < len(sorted); i++ {
		t := sorted[i]
		if t >= end {
			break
		}
		lag := float64(onset-t) / hourMs
		if lag >= 0 && (best == nil || lag < *best) {
			v := lag
			best = &v
		}
	}
	return best
}

// diarySet is the Set of diary dates, iterated in insertion order.
type diarySet struct {
	order []string
	has   map[string]bool
}

func newDiarySet(dates []string) diarySet {
	d := diarySet{has: map[string]bool{}}
	for _, s := range dates {
		if !d.has[s] {
			d.has[s] = true
			d.order = append(d.order, s)
		}
	}
	return d
}

type matchedSet struct {
	caseMs   int64
	controls []int64
}

type engine struct {
	userID       string
	cfg          Config
	loc          *time.Location
	zone         string
	now          time.Time
	start, end   int64
	diary        diarySet
	attacks      []attackWindow
	attackStarts []int64
}

func (e *engine) pickControls(caseMs int64) ([]int64, int) {
	var sameDow, other []int64
	rejected := 0
	caseLocal := time.UnixMilli(caseMs).In(e.loc)
	for _, ymd := range e.diary.order {
		day, ok := luxon.FromISO(ymd, e.loc, e.now)
		var cand time.Time
		if ok {
			cand, ok = luxon.SetTime(day, e.loc, caseLocal.Hour(), caseLocal.Minute(), caseLocal.Second(), caseLocal.Nanosecond()/int(time.Millisecond))
		}
		if !ok {
			rejected++
			continue
		}
		t := cand.UnixMilli()
		if t < e.start || t >= e.end || withinAttack(e.attacks, t) || startWithinGuard(e.attackStarts, t, e.cfg.ControlGuardHours) {
			rejected++
			continue
		}
		if cand.In(e.loc).Weekday() == caseLocal.Weekday() {
			sameDow = append(sameDow, t)
		} else {
			other = append(other, t)
		}
	}
	pool := sameDow
	if len(sameDow) < e.cfg.ControlsPerCase {
		pool = append(append([]int64{}, sameDow...), other...)
	}
	if len(pool) <= e.cfg.ControlsPerCase {
		out := append([]int64{}, pool...)
		slices.Sort(out)
		return out, rejected
	}
	r := newRng(hashStringToSeed32(e.userID + ":controls:" + strconv.FormatInt(caseMs, 10)))
	draft := append([]int64{}, pool...)
	var picked []int64
	for len(picked) < e.cfg.ControlsPerCase && len(draft) > 0 {
		idx := r.intn(0, len(draft)-1)
		picked = append(picked, draft[idx])
		draft = append(draft[:idx], draft[idx+1:]...)
	}
	slices.Sort(picked)
	return picked, rejected
}

func (e *engine) covered(start, end int64) bool {
	endT := time.UnixMilli(end)
	for _, d := range localdate.Overlapped(time.UnixMilli(start), &endT, e.zone) {
		if !e.diary.has[d] {
			return false
		}
	}
	return true
}

type exposureSet struct {
	exposures  []*int // nil is missing coverage
	caseMinLag *float64
}

func one(b bool) *int {
	v := 0
	if b {
		v = 1
	}
	return &v
}

func (e *engine) exposure(times []int64, w windowSpec, s matchedSet) exposureSet {
	onset := s.caseMs
	ws, we := onset-msHours(w.toHrs), onset-msHours(w.fromHours)
	var out exposureSet
	if e.covered(ws, we) {
		out.exposures = append(out.exposures, one(anyEventIn(times, ws, we)))
		out.caseMinLag = minLagHours(times, ws, we, onset)
	} else {
		out.exposures = append(out.exposures, nil)
	}
	for _, t := range s.controls {
		cs, ce := t-msHours(w.toHrs), t-msHours(w.fromHours)
		if e.covered(cs, ce) {
			out.exposures = append(out.exposures, one(anyEventIn(times, cs, ce)))
		} else {
			out.exposures = append(out.exposures, nil)
		}
	}
	return out
}

func wilson(successes, total int) (float64, float64) {
	if total <= 0 {
		return 0, 1
	}
	z := 1.96 // a variable: a Go constant would square at arbitrary precision
	n := float64(total)
	phat := float64(successes) / n
	z2 := float64(z * z)
	denom := 1 + z2/n
	center := (phat + z2/float64(2*n)) / denom
	radius := float64((z / denom) * math.Sqrt((float64(phat*(1-phat))+z2/float64(4*n))/n))
	return max(0, center-radius), min(1, center+radius)
}

var (
	negInf  = math.Inf(-1)
	logFact = []float64{0}
	logMu   sync.Mutex
)

// logFactorial is the memoised sum of logs; the cache is shared across
// requests, hence the lock.
func logFactorial(n int) float64 {
	logMu.Lock()
	defer logMu.Unlock()
	for i := len(logFact); i <= n; i++ {
		logFact = append(logFact, logFact[i-1]+jsx.Log(float64(i)))
	}
	return logFact[n]
}

func logChoose(n, k int) float64 {
	if k < 0 || k > n {
		return negInf
	}
	return logFactorial(n) - logFactorial(k) - logFactorial(n-k)
}

func fisherP(caseExposed, caseTotal, controlExposed, controlTotal int) float64 {
	a, b, c, d := caseExposed, caseTotal-caseExposed, controlExposed, controlTotal-controlExposed
	row1, row2, col1, col2 := caseTotal, controlTotal, a+c, b+d
	minA, maxA := max(0, col1-row2), min(col1, row1)
	logDenom := logChoose(row1+row2, row1)
	prob := func(a int) float64 {
		b, c := row1-a, col1-a
		d := row2 - c
		if b < 0 || c < 0 || d < 0 {
			return 0
		}
		return jsx.Exp(logChoose(col1, a) + logChoose(col2, b) - logDenom)
	}
	pObs := prob(a)
	p := 0.0
	for x := minA; x <= maxA; x++ {
		if px := prob(x); px <= pObs+1e-12 {
			p += px
		}
	}
	return min(1, max(0, p))
}

func benjaminiHochberg(p []float64) []float64 {
	m := len(p)
	idx := make([]int, m)
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(i, j int) bool { return p[idx[i]] < p[idx[j]] })
	q := make([]float64, m)
	for rank := 1; rank <= m; rank++ {
		q[rank-1] = float64(p[idx[rank-1]]*float64(m)) / float64(rank)
	}
	for i := m - 2; i >= 0; i-- {
		q[i] = min(q[i], q[i+1])
	}
	out := make([]float64, m)
	for k := range m {
		out[idx[k]] = max(0, min(1, q[k]))
	}
	return out
}

func (e *engine) confidence(attackStarts int, ciExcludesZero bool, q float64) string {
	switch {
	case attackStarts >= e.cfg.HighConfidenceAttackStart && ciExcludesZero && q <= e.cfg.Alpha:
		return "high"
	case attackStarts >= e.cfg.MinAttackStarts && (ciExcludesZero || q <= e.cfg.Alpha):
		return "medium"
	default:
		return "low"
	}
}

const disclaimer = "These are conservative associations in your data. They might be coincidence, and the app cannot determine cause and effect or give medical advice."

func iso(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }

func mondayOf(d time.Time) time.Time {
	wd := int(d.Weekday())
	if wd == 0 {
		wd = 7
	}
	return d.AddDate(0, 0, -(wd - 1))
}

type candidate struct {
	factorID       string
	window         string
	pValue, qValue float64
	caseRate       float64
	controlRate    float64
	riskDiff       float64
	ci             Interval
	counts         Counts
	totalExposures int
	earlySign      bool
	ciExcludesZero bool
}

// Compute is computeInsightsForUser. startedAt feeds runtimeMs.
func Compute(userID string, now time.Time, cfg Config, episodes []Episode, factors []Factor, events []FactorEvent,
	diaryDates []string, zone string, clock func() time.Time) Result {
	startedAt := clock()
	loc := tz.LoadOrUTC(zone)
	nowMs := now.UnixMilli()
	e := &engine{userID: userID, cfg: cfg, loc: loc, zone: zone, now: now,
		start: nowMs - int64(cfg.WindowDays)*24*hourMs, end: nowMs, diary: newDiarySet(diaryDates)}

	endLocal := now.In(loc)
	endDay := time.Date(endLocal.Year(), endLocal.Month(), endLocal.Day(), 0, 0, 0, 0, time.UTC)
	startDay := endDay.AddDate(0, 0, -(cfg.WindowDays - 1))

	observed := len(e.diary.order)
	coverage := 0.0
	if cfg.WindowDays > 0 {
		coverage = float64(observed) / float64(cfg.WindowDays)
	}
	var inWindow []Episode
	for _, ep := range episodes {
		if ep.StartMs >= e.start && ep.StartMs <= e.end {
			inWindow = append(inWindow, ep)
		}
	}
	attackStarts := len(inWindow)
	missing := []string{}
	if observed < cfg.MinDiaryDays {
		missing = append(missing, "More diary-complete days")
	}
	if attackStarts < cfg.MinAttackStarts {
		missing = append(missing, "More attack starts")
	}

	weekCounts := map[string]int{}
	for _, ep := range inWindow {
		l := time.UnixMilli(ep.StartMs).In(loc)
		key := mondayOf(time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)).Format(localdate.Layout)
		weekCounts[key]++
	}
	trend := []TrendPoint{}
	for cur, last := mondayOf(startDay), mondayOf(endDay); !cur.After(last); cur = cur.AddDate(0, 0, 7) {
		key := cur.Format(localdate.Layout)
		trend = append(trend, TrendPoint{key, weekCounts[key]})
	}

	p := Payload{
		MethodVersion: cfg.MethodVersion, WindowDays: cfg.WindowDays, ComputedAt: iso(nowMs), Disclaimer: disclaimer,
		Status: "ready",
		DataReadiness: Readiness{DiaryDaysRecorded: observed, DiaryDaysTotal: cfg.WindowDays, DiaryCoveragePct: Num(coverage),
			AttackStarts: attackStarts, LastComputedAt: iso(nowMs), Missing: missing},
		Highlights: []Card{},
		Buckets: []Bucket{
			{"likely_increases", "Likely increases risk", []Card{}},
			{"likely_decreases", "Likely decreases risk", []Card{}},
			{"no_clear_association", "No clear association", []Card{}},
		},
		Trends: Trends{trend},
		InputStats: InputStats{WindowDays: cfg.WindowDays, NowUtc: iso(nowMs), EpisodesInWindow: attackStarts,
			DiaryDaysObserved: observed, ControlsPerCase: cfg.ControlsPerCase,
			Exclusions: Exclusions{EpisodesOutsideWindow: max(len(episodes)-attackStarts, 0)}},
	}
	finish := func(status, reason string) Result {
		p.InputStats.RuntimeMs = clock().Sub(startedAt).Milliseconds()
		switch status {
		case "insufficient_data", "no_strong_signals":
			p.Status = status
		}
		return Result{Status: status, Reason: reason, Payload: p}
	}
	if observed < cfg.MinDiaryDays {
		return finish("insufficient_data", "not_enough_diary_days")
	}
	if attackStarts < cfg.MinAttackStarts {
		return finish("insufficient_data", "not_enough_cases")
	}

	e.attacks = buildAttackWindows(episodes, nowMs)
	for _, ep := range episodes {
		e.attackStarts = append(e.attackStarts, ep.StartMs)
	}
	slices.Sort(e.attackStarts)

	var inRange, outside []FactorEvent
	for _, ev := range events {
		if ev.OccurredMs >= e.start && ev.OccurredMs <= e.end {
			inRange = append(inRange, ev)
		}
	}
	for _, ev := range inRange {
		if !withinAttack(e.attacks, ev.OccurredMs) {
			outside = append(outside, ev)
		}
	}
	p.InputStats.Exclusions.FactorEventsDuringAttack = len(inRange) - len(outside)

	info := map[string]Factor{}
	for _, f := range factors {
		info[f.ID] = f
	}
	var factorIDs []string
	seen := map[string]bool{}
	for _, ev := range outside {
		if !seen[ev.FactorID] {
			seen[ev.FactorID] = true
			if _, ok := info[ev.FactorID]; ok {
				factorIDs = append(factorIDs, ev.FactorID)
			}
		}
	}
	p.InputStats.FactorsTested = len(factorIDs) * len(windows)
	if len(factorIDs) == 0 {
		return finish("insufficient_data", "no_factors")
	}

	times := map[string][]int64{}
	for _, ev := range outside {
		times[ev.FactorID] = append(times[ev.FactorID], ev.OccurredMs)
	}
	for k := range times {
		slices.Sort(times[k])
	}

	var sets []matchedSet
	rejected := 0
	for _, ep := range episodes {
		if ep.StartMs < e.start || ep.StartMs >= e.end {
			continue
		}
		controls, rej := e.pickControls(ep.StartMs)
		rejected += rej
		if len(controls) > 0 {
			sets = append(sets, matchedSet{ep.StartMs, controls})
		}
	}
	p.InputStats.CaseMomentsUsed = len(sets)
	p.InputStats.Exclusions.CandidateControlsRejected = rejected
	if len(sets) < cfg.MinCaseMoments {
		return finish("insufficient_data", "no_valid_controls")
	}

	var all []candidate
	for _, w := range windows {
		var temp []candidate
		var pValues []float64
		for _, fid := range factorIDs {
			var setsUsed, controlsTotal, controlsExposed, caseTotal, caseExposed, perSetSum, earlyExposed, earlyClose int
			for _, s := range sets {
				x := e.exposure(times[fid], w, s)
				caseV := x.exposures[0]
				if caseV == nil {
					continue
				}
				var observed []int
				for _, c := range x.exposures[1:] {
					if c != nil {
						observed = append(observed, *c)
					}
				}
				if len(observed) == 0 {
					continue
				}
				setsUsed++
				caseTotal++
				caseExposed += *caseV
				perSetSum += len(observed)
				controlsTotal += len(observed)
				for _, c := range observed {
					controlsExposed += c
				}
				if *caseV == 1 {
					earlyExposed++
					if x.caseMinLag != nil && *x.caseMinLag <= cfg.EarlySignCloseHours {
						earlyClose++
					}
				}
			}
			if setsUsed < cfg.MinCaseMoments {
				continue
			}
			total := caseExposed + controlsExposed
			if total < cfg.MinTotalExposures {
				continue
			}
			caseRate, controlRate := 0.0, 0.0
			if caseTotal > 0 {
				caseRate = float64(caseExposed) / float64(caseTotal)
			}
			if controlsTotal > 0 {
				controlRate = float64(controlsExposed) / float64(controlsTotal)
			}
			caseLow, caseHigh := wilson(caseExposed, caseTotal)
			ctlLow, ctlHigh := wilson(controlsExposed, controlsTotal)
			ci := Interval{Num(caseLow - ctlHigh), Num(caseHigh - ctlLow)}
			pv := fisherP(caseExposed, caseTotal, controlsExposed, controlsTotal)
			early := info[fid].Type == "symptom" ||
				(earlyExposed > 0 && float64(earlyClose)/float64(earlyExposed) >= cfg.EarlySignShareThreshold)
			avg := 0.0
			if setsUsed > 0 {
				avg = float64(perSetSum) / float64(setsUsed)
			}
			temp = append(temp, candidate{
				factorID: fid, window: w.id, pValue: pv, caseRate: caseRate, controlRate: controlRate,
				riskDiff: caseRate - controlRate, ci: ci, totalExposures: total, earlySign: early,
				ciExcludesZero: ci.Low > 0 || ci.High < 0,
				counts:         Counts{setsUsed, Num(avg), caseExposed, caseTotal, controlsExposed, controlsTotal},
			})
			pValues = append(pValues, pv)
		}
		if len(temp) > 0 {
			q := benjaminiHochberg(pValues)
			for i := range temp {
				temp[i].qValue = q[i]
			}
			all = append(all, temp...)
		}
	}
	if len(all) == 0 {
		return finish("no_strong_signals", "")
	}

	var order []string
	byFactor := map[string][]candidate{}
	for _, c := range all {
		if _, ok := byFactor[c.factorID]; !ok {
			order = append(order, c.factorID)
		}
		byFactor[c.factorID] = append(byFactor[c.factorID], c)
	}

	card := func(fid string, c candidate, bucket, direction, confidence string, early bool) Card {
		f := info[fid]
		return Card{ID: fid + ":" + c.window, FactorID: fid, FactorName: f.DisplayName, FactorType: f.Type, Window: c.window,
			Bucket: bucket, Direction: direction, CaseRate: Num(c.caseRate), ControlRate: Num(c.controlRate),
			RiskDiff: Num(c.riskDiff), RiskDiffCi: c.ci, PValue: Num(c.pValue), QValue: Num(c.qValue),
			Confidence: confidence, PossibleEarlySign: early, Counts: c.counts}
	}
	increases, decreases, noClear := []Card{}, []Card{}, []Card{}
	for _, fid := range order {
		list := byFactor[fid]
		var signals []candidate
		outside12 := false
		for _, c := range list {
			if c.ciExcludesZero || c.qValue <= cfg.Alpha {
				signals = append(signals, c)
				if c.window != "0_12h" {
					outside12 = true
				}
			}
		}
		if len(signals) == 0 {
			sorted := append([]candidate{}, list...)
			sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].totalExposures > sorted[j].totalExposures })
			best := sorted[0]
			if conf := e.confidence(attackStarts, false, best.qValue); conf != "low" {
				noClear = append(noClear, card(fid, best, "no_clear_association", "no_clear", conf, false))
			}
			continue
		}
		for _, s := range signals {
			conf := e.confidence(attackStarts, s.ciExcludesZero, s.qValue)
			early := s.earlySign && s.window == "0_12h" && !outside12
			if early && conf == "high" {
				conf = "medium"
			} else if early && conf == "medium" {
				conf = "low"
			}
			direction, bucket := "increase", "likely_increases"
			if s.riskDiff < 0 {
				direction, bucket = "decrease", "likely_decreases"
			}
			if conf == "low" {
				continue
			}
			c := card(fid, s, bucket, direction, conf, early)
			if direction == "increase" {
				increases = append(increases, c)
			} else {
				decreases = append(decreases, c)
			}
		}
	}

	rank := func(c string) int {
		switch c {
		case "high":
			return 2
		case "medium":
			return 1
		}
		return 0
	}
	byConfidence := func(a, b Card) int {
		if rank(a.Confidence) != rank(b.Confidence) {
			return rank(b.Confidence) - rank(a.Confidence)
		}
		if a.QValue != b.QValue {
			return cmpFloat(float64(a.QValue) - float64(b.QValue))
		}
		return cmpFloat(jsAbs(float64(b.RiskDiff)) - jsAbs(float64(a.RiskDiff)))
	}
	slices.SortStableFunc(increases, byConfidence)
	slices.SortStableFunc(decreases, byConfidence)
	slices.SortStableFunc(noClear, func(a, b Card) int { return b.Counts.CaseTotal - a.Counts.CaseTotal })

	var hl []Card
	for _, c := range append(append([]Card{}, increases...), decreases...) {
		if c.FactorType == "trigger" || c.FactorType == "protector" {
			hl = append(hl, c)
		}
	}
	slices.SortStableFunc(hl, byConfidence)
	p.Highlights = append([]Card{}, hl[:min(len(hl), cfg.MaxHighlights)]...)
	p.Buckets = []Bucket{
		{"likely_increases", "Likely increases risk", increases[:min(len(increases), cfg.MaxPerBucket)]},
		{"likely_decreases", "Likely decreases risk", decreases[:min(len(decreases), cfg.MaxPerBucket)]},
		{"no_clear_association", "No clear association", noClear[:min(len(noClear), cfg.MaxPerBucket)]},
	}
	if len(increases)+len(decreases) == 0 {
		p.Status = "no_strong_signals"
		p.InputStats.RuntimeMs = clock().Sub(startedAt).Milliseconds()
		return Result{Status: "no_strong_signals", Payload: p}
	}
	p.Status = "ready"
	p.InputStats.RuntimeMs = clock().Sub(startedAt).Milliseconds()
	return Result{Status: "ok", Payload: p}
}

// cmpFloat turns a JavaScript comparator result into a sort order; NaN is
// "equal", as Array.prototype.sort treats it.
func cmpFloat(d float64) int {
	switch {
	case d < 0:
		return -1
	case d > 0:
		return 1
	}
	return 0
}

func jsAbs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}
