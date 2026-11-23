// Package cycle is the menstrual cycle module (CycleService, cycleDomain).
package cycle

import (
	"context"
	"errors"
	"math"
	"regexp"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
)

var ymdRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ErrInvalidDate is normalizeDate's error.
var ErrInvalidDate = errors.New("Invalid date")

// NormalizeDate is normalizeDate: YYYY-MM-DD as is, other ISO strings as their
// UTC date.
func NormalizeDate(v string) (string, error) {
	if ymdRe.MatchString(v) {
		return v, nil
	}
	t, err := jsontime.Parse(v)
	if err != nil {
		return "", ErrInvalidDate
	}
	return t.UTC().Format(localdate.Layout), nil
}

func parseYMD(s string) time.Time { t, _ := time.Parse(localdate.Layout, s); return t }

// DiffInDays is diffInDays (rounded whole days between UTC dates).
func DiffInDays(from, to string) int {
	return int(math.Round(parseYMD(to).Sub(parseYMD(from)).Hours() / 24))
}

// BleedingStartDates is computeBleedingStartDates.
func BleedingStartDates(days map[string]bool) []string {
	sorted := make([]string, 0, len(days))
	for d := range days {
		sorted = append(sorted, d)
	}
	sort.Strings(sorted)
	var starts []string
	for _, d := range sorted {
		prev := parseYMD(d).AddDate(0, 0, -1).Format(localdate.Layout)
		if !days[prev] {
			starts = append(starts, d)
		}
	}
	if starts == nil {
		starts = []string{}
	}
	return starts
}

// CycleDay is getCycleDay.
func CycleDay(date string, lastStart *string) *int {
	if lastStart == nil || date < *lastStart {
		return nil
	}
	d := DiffInDays(*lastStart, date) + 1
	return &d
}

// InWindow is isInPerimenstrualWindow.
func InWindow(date string, start *string, from, to int) bool {
	if start == nil {
		return false
	}
	rel := DiffInDays(*start, date)
	return rel >= from && rel <= to
}

// NearestStart is nearestStartDate: the closest start, first wins ties.
func NearestStart(date string, starts []string) *string {
	var best *string
	bestDist := math.Inf(1)
	for i := range starts {
		d := math.Abs(float64(DiffInDays(starts[i], date)))
		if d < bestDist {
			bestDist = d
			best = &starts[i]
		}
	}
	return best
}

// Histogram is buildRelativeAttackHistogram as ordered (day, count) pairs.
func Histogram(attackDates, starts []string, from, to int) []any {
	sorted := append([]string{}, starts...)
	sort.Strings(sorted)
	counts := map[int]int{}
	for _, a := range attackDates {
		s := NearestStart(a, sorted)
		if s == nil {
			continue
		}
		rel := DiffInDays(*s, a)
		if rel < from || rel > to {
			continue
		}
		counts[rel]++
	}
	out := make([]any, 0, to-from+1)
	for d := from; d <= to; d++ {
		out = append(out, httpx.O("relativeDay", d, "count", counts[d]))
	}
	return out
}

// Settings is CycleSettingsDTO.
type Settings struct {
	Enabled          bool
	IncludeInExports bool
	PrivacyMode      string
	StartDays        int32
	EndDays          int32
	HormoneProfile   string
	UpdatedAt        *time.Time
}

// JSON is the settings response shape.
func (s Settings) JSON() *httpx.Object {
	var updated any
	if s.UpdatedAt != nil {
		updated = jsontime.Format(*s.UpdatedAt)
	}
	return httpx.O("enabled", s.Enabled, "includeInExports", s.IncludeInExports, "privacyMode", s.PrivacyMode,
		"perimenstrualWindowStartDays", s.StartDays, "perimenstrualWindowEndDays", s.EndDays,
		"hormoneProfile", s.HormoneProfile, "updatedAt", updated)
}

var defaults = Settings{PrivacyMode: "local_only", StartDays: -2, EndDays: 3, HormoneProfile: "unknown"}

// Service is CycleService.
type Service struct {
	Q   *q.Queries
	Now func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// GetSettings is getSettings.
func (s *Service) GetSettings(ctx context.Context, userID string) (Settings, error) {
	row, err := s.Q.GetCycleSettings(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return defaults, nil
	}
	if err != nil {
		return Settings{}, err
	}
	t := row.UpdatedAt.Time
	return Settings{row.Enabled, row.IncludeInExports, row.PrivacyMode, row.PerimenstrualWindowStartDays,
		row.PerimenstrualWindowEndDays, row.HormoneProfile, &t}, nil
}

// SettingsPatch holds the present keys of a settings update.
type SettingsPatch struct {
	Enabled          *bool   `json:"enabled"`
	IncludeInExports *bool   `json:"includeInExports"`
	PrivacyMode      *string `json:"privacyMode"`
	StartDays        *int32  `json:"perimenstrualWindowStartDays"`
	EndDays          *int32  `json:"perimenstrualWindowEndDays"`
	HormoneProfile   *string `json:"hormoneProfile"`
}

// UpsertSettings is upsertSettings. Window errors carry the user-facing text.
func (s *Service) UpsertSettings(ctx context.Context, userID string, p SettingsPatch) (Settings, error) {
	next, err := s.GetSettings(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	if p.Enabled != nil {
		next.Enabled = *p.Enabled
	}
	if p.IncludeInExports != nil {
		next.IncludeInExports = *p.IncludeInExports
	}
	if p.PrivacyMode != nil {
		next.PrivacyMode = *p.PrivacyMode
	}
	if p.StartDays != nil {
		next.StartDays = *p.StartDays
	}
	if p.EndDays != nil {
		next.EndDays = *p.EndDays
	}
	if p.HormoneProfile != nil {
		next.HormoneProfile = *p.HormoneProfile
	}
	switch {
	case next.StartDays < -5 || next.StartDays > 0:
		return Settings{}, errors.New("Window start must be between -5 and 0")
	case next.EndDays < 0 || next.EndDays > 7:
		return Settings{}, errors.New("Window end must be between 0 and 7")
	case next.StartDays > next.EndDays:
		return Settings{}, errors.New("Window start must be <= window end")
	}
	row, err := s.Q.UpsertCycleSettings(ctx, q.UpsertCycleSettingsParams{
		UserID: userID, Enabled: next.Enabled, IncludeInExports: next.IncludeInExports, PrivacyMode: next.PrivacyMode,
		StartDays: next.StartDays, EndDays: next.EndDays, HormoneProfile: next.HormoneProfile, Now: jsontime.New(s.now()),
	})
	if err != nil {
		return Settings{}, err
	}
	t := row.UpdatedAt.Time
	next.UpdatedAt = &t
	return next, nil
}

// dbDate is ymdToDbDate: V8 rolls 2026-02-30 over to 2026-03-02 and rejects
// month 13 with "Invalid time value".
func dbDate(ymd string) (jsontime.Date, error) {
	d, err := localdate.JSDateFromYMD(ymd)
	return jsontime.NewDate(d), err
}

// Day is a CycleCalendarDayDTO.
func Day(ymd string, bleeding bool, flow string) *httpx.Object {
	return httpx.O("localDate", ymd, "bleeding", bleeding, "flow", flow)
}

func (s *Service) getDay(ctx context.Context, userID, ymd string) (*q.CycleBleedingDay, error) {
	day, err := dbDate(ymd)
	if err != nil {
		return nil, err
	}
	row, err := s.Q.GetBleedingDay(ctx, userID, day)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// SetDay is setBleedingDay. flow "" is unspecified.
func (s *Service) SetDay(ctx context.Context, userID, ymd string, bleeding bool, flow string) (*httpx.Object, error) {
	if flow == "" {
		flow = "unspecified"
	}
	day, err := dbDate(ymd)
	if err != nil {
		return nil, err
	}
	row, err := s.Q.UpsertBleedingDay(ctx, q.UpsertBleedingDayParams{UserID: userID, LocalDate: day, Bleeding: bleeding, Flow: flow, Now: jsontime.New(s.now())})
	if err != nil {
		return nil, err
	}
	return Day(ymd, row.Bleeding, row.Flow), nil
}

// ToggleDay is toggleBleedingDay.
func (s *Service) ToggleDay(ctx context.Context, userID, ymd string) (*httpx.Object, error) {
	existing, err := s.getDay(ctx, userID, ymd)
	if err != nil {
		return nil, err
	}
	bleeding, flow := false, "unspecified"
	if existing != nil {
		bleeding, flow = existing.Bleeding, existing.Flow
	}
	return s.SetDay(ctx, userID, ymd, !bleeding, flow)
}

// SetFlow is setFlow.
func (s *Service) SetFlow(ctx context.Context, userID, ymd, flow string) (*httpx.Object, error) {
	existing, err := s.getDay(ctx, userID, ymd)
	if err != nil {
		return nil, err
	}
	bleeding := true
	if existing != nil {
		bleeding = existing.Bleeding
	}
	return s.SetDay(ctx, userID, ymd, bleeding, flow)
}

// DeleteDay is deleteBleedingDay.
func (s *Service) DeleteDay(ctx context.Context, userID, ymd string) error {
	day, err := dbDate(ymd)
	if err != nil {
		return err
	}
	return s.Q.DeleteBleedingDay(ctx, userID, day)
}

// StartDates is getBleedingStartDates.
func (s *Service) StartDates(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.Q.BleedingDates(ctx, userID)
	if err != nil {
		return nil, err
	}
	days := map[string]bool{}
	for _, d := range rows {
		days[d.YMD()] = true
	}
	return BleedingStartDates(days), nil
}

// Calendar is getCalendarRange.
func (s *Service) Calendar(ctx context.Context, userID, fromRaw, toRaw string) (*httpx.Object, error) {
	from, err := NormalizeDate(fromRaw)
	if err != nil {
		return nil, err
	}
	to, err := NormalizeDate(toRaw)
	if err != nil {
		return nil, err
	}
	zone, err := usertz.Get(ctx, s.Q, userID)
	if err != nil {
		return nil, err
	}
	fromDB, err := dbDate(from)
	if err != nil {
		return nil, err
	}
	toDB, err := dbDate(to)
	if err != nil {
		return nil, err
	}
	rows, err := s.Q.BleedingDaysBetween(ctx, userID, fromDB, toDB)
	if err != nil {
		return nil, err
	}
	migraine, err := s.Q.MigraineDiaryDaysBetween(ctx, userID, fromDB, toDB)
	if err != nil {
		return nil, err
	}
	days := make([]any, len(rows))
	bleeding := map[string]bool{}
	for i, r := range rows {
		days[i] = Day(r.LocalDate.YMD(), r.Bleeding, r.Flow)
		if r.Bleeding {
			bleeding[r.LocalDate.YMD()] = true
		}
	}
	mdays := make([]string, len(migraine))
	for i, d := range migraine {
		mdays[i] = d.YMD()
	}
	sort.Strings(mdays)
	return httpx.O("timezone", zone, "from", from, "to", to, "days", days,
		"bleedingStartDates", BleedingStartDates(bleeding), "migraineDays", mdays), nil
}

func lastStartOnOrBefore(date string, starts []string) *string {
	sorted := append([]string{}, starts...)
	sort.Strings(sorted)
	var last *string
	for i := range sorted {
		if sorted[i] <= date {
			last = &sorted[i]
		} else {
			break
		}
	}
	return last
}

// Context is getContextForDate.
func (s *Service) Context(ctx context.Context, userID, raw string) (*httpx.Object, error) {
	date, err := NormalizeDate(raw)
	if err != nil {
		return nil, err
	}
	settings, err := s.GetSettings(ctx, userID)
	if err != nil {
		return nil, err
	}
	starts, err := s.StartDates(ctx, userID)
	if err != nil {
		return nil, err
	}
	anchor := NearestStart(date, starts)
	var rel any
	if anchor != nil {
		rel = DiffInDays(*anchor, date)
	}
	return httpx.O("date", date, "enabled", settings.Enabled, "cycleDay", CycleDay(date, lastStartOnOrBefore(date, starts)),
		"relativeDay", rel, "withinPerimenstrualWindow", InWindow(date, anchor, int(settings.StartDays), int(settings.EndDays)),
		"anchorBleedStartDate", anchor), nil
}

// DefaultRange is the insights route's default: the last 90 days in zone.
func (s *Service) DefaultRange(zone string) (string, string) {
	loc := tz.LoadOrUTC(zone)
	now := s.now().In(loc)
	return now.AddDate(0, 0, -89).Format(localdate.Layout), now.Format(localdate.Layout)
}

// Insights is getInsights.
func (s *Service) Insights(ctx context.Context, userID, fromRaw, toRaw string) (*httpx.Object, error) {
	from, err := NormalizeDate(fromRaw)
	if err != nil {
		return nil, err
	}
	to, err := NormalizeDate(toRaw)
	if err != nil {
		return nil, err
	}
	zone, err := usertz.Get(ctx, s.Q, userID)
	if err != nil {
		return nil, err
	}
	settings, err := s.GetSettings(ctx, userID)
	if err != nil {
		return nil, err
	}
	starts, err := s.StartDates(ctx, userID)
	if err != nil {
		return nil, err
	}
	rs, re := localdate.UTCRange(zone, []string{from, to})
	if from > to {
		// Luxon built the window from each bound separately.
		loc := tz.LoadOrUTC(zone)
		a, _ := localdate.ParseInZone(from, loc)
		b, _ := localdate.ParseInZone(to, loc)
		n := b.AddDate(0, 0, 1)
		rs, re = a.UTC(), time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, loc).UTC()
	}
	attacks, err := s.Q.MigraineStartsBetween(ctx, userID, jsontime.New(rs), jsontime.New(re))
	if err != nil {
		return nil, err
	}
	dates := make([]string, len(attacks))
	for i, a := range attacks {
		dates[i] = localdate.String(a.Time, zone)
	}
	sort.Strings(dates)
	in := 0
	for _, d := range dates {
		if InWindow(d, NearestStart(d, starts), int(settings.StartDays), int(settings.EndDays)) {
			in++
		}
	}
	var pct any
	if len(dates) > 0 {
		pct = float64(in) / float64(len(dates))
	}
	return httpx.O(
		"enabled", settings.Enabled, "hasEnoughData", len(starts) >= 2, "totalAttacks", len(dates),
		"attacksInWindow", in, "attacksOutOfWindow", max(0, len(dates)-in), "inWindowPct", pct,
		"rangeStart", settings.StartDays, "rangeEnd", settings.EndDays,
		"histogram", Histogram(dates, starts, -5, 7), "bleedingStartCount", len(starts),
	), nil
}

// DeleteAll is deleteAllData.
func (s *Service) DeleteAll(ctx context.Context, userID string) error {
	if err := s.Q.DeleteAllBleedingDays(ctx, userID); err != nil {
		return err
	}
	return s.Q.DeleteCycleSettings(ctx, userID)
}
