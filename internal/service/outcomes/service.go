package outcomes

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/luxon"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
)

// responderMinCoverage is RESPONDER_MIN_COVERAGE.
const responderMinCoverage = 0.8

// Service is OutcomesService.
type Service struct {
	Q   *q.Queries
	Now func() time.Time
}

// Settings is getOutcomeSettings's result.
type Settings struct {
	BaselineStart, BaselineEnd *time.Time
	PreferredWindowDays        int
	Timezone                   string
}

// JSON is the settings response body.
func (s Settings) JSON() *httpx.Object {
	iso := func(t *time.Time) any {
		if t == nil {
			return nil
		}
		return jsontime.Format(*t)
	}
	return httpx.O("baselineStart", iso(s.BaselineStart), "baselineEnd", iso(s.BaselineEnd),
		"preferredWindowDays", s.PreferredWindowDays, "timezone", s.Timezone)
}

func timePtr(t *jsontime.Time) *time.Time {
	if t == nil {
		return nil
	}
	v := t.Time
	return &v
}

// GetSettings is getOutcomeSettings.
func (s *Service) GetSettings(ctx context.Context, uid string) (Settings, error) {
	zone, err := usertz.Get(ctx, s.Q, uid)
	if err != nil {
		return Settings{}, err
	}
	out := Settings{PreferredWindowDays: 28, Timezone: zone}
	row, err := s.Q.GetOutcomeSettings(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return Settings{}, err
	}
	out.BaselineStart, out.BaselineEnd = timePtr(row.BaselineStart), timePtr(row.BaselineEnd)
	out.PreferredWindowDays = int(row.PreferredWindowDays)
	return out, nil
}

func jsPtr(t *time.Time) *jsontime.Time {
	if t == nil {
		return nil
	}
	return jsontime.Ptr(*t)
}

// UpsertSettings is upsertOutcomeSettings with timezone null.
func (s *Service) UpsertSettings(ctx context.Context, uid string, start, end *time.Time, windowDays int) error {
	_, err := s.Q.GetOutcomeSettings(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.Q.InsertOutcomeSettings(ctx, uid, jsPtr(start), jsPtr(end), int32(windowDays))
	}
	if err != nil {
		return err
	}
	return s.Q.UpdateOutcomeSettings(ctx, q.UpdateOutcomeSettingsParams{
		BaselineStart: jsPtr(start), BaselineEnd: jsPtr(end), PreferredWindowDays: int32(windowDays),
		Now: jsontime.New(s.Now()), UserID: uid,
	})
}

// LocalStartUTC is DateTime.fromISO(ymd, { zone }).startOf('day') as an
// instant; ok is false for Luxon's Invalid DateTime.
func (s *Service) LocalStartUTC(ymd string, loc *time.Location) (time.Time, bool) {
	t, ok := luxon.FromISO(ymd, loc, s.Now())
	if !ok {
		return time.Time{}, false
	}
	return localdate.StartOfDay(t, loc), true
}

func addDays(ymd string, n int) string {
	t, _ := time.Parse(localdate.Layout, ymd)
	return t.AddDate(0, 0, n).Format(localdate.Layout)
}

func (s *Service) diary(ctx context.Context, uid, from, to string) ([]DiaryDay, error) {
	f, err1 := localdate.JSDateFromYMD(from)
	t, err2 := localdate.JSDateFromYMD(to)
	if err := errors.Join(err1, err2); err != nil {
		return nil, localdate.ErrInvalidTimeValue
	}
	rows, err := s.Q.DiaryDayTypesBetween(ctx, uid, jsontime.NewDate(f), jsontime.NewDate(t))
	if err != nil {
		return nil, err
	}
	out := make([]DiaryDay, len(rows))
	for i, r := range rows {
		out[i] = DiaryDay{LocalDate: r.LocalDate.YMD(), DayType: r.DayType}
	}
	return out, nil
}

// intakes returns the named medication intakes in [from, to): rows whose
// resolved name is empty are dropped, as OutcomesService did.
func (s *Service) intakes(ctx context.Context, uid string, from, to time.Time) ([]MedicationIntake, error) {
	rows, err := s.Q.MedicationIntakeNamesBetween(ctx, uid, jsontime.New(from), jsontime.New(to))
	if err != nil {
		return nil, err
	}
	out := []MedicationIntake{}
	for _, r := range rows {
		name := ""
		for _, p := range []*string{r.MedicationName, r.CustomName, r.CanonicalName} {
			if p != nil {
				name = *p
				break
			}
		}
		if name = jsx.Trim(name); name != "" {
			out = append(out, MedicationIntake{TakenAt: r.TakenAt.Time, Name: name})
		}
	}
	return out, nil
}

func (r Result) object() *httpx.Object {
	return httpx.O("windowDays", r.WindowDays, "timezone", r.Timezone, "totals", r.Totals, "daily", r.Daily)
}

// Compute is computeOutcomes. from/to are "" when absent.
func (s *Service) Compute(ctx context.Context, uid, from, to string, windowDays int) (*httpx.Object, error) {
	settings, err := s.GetSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	zone := settings.Timezone
	loc, ok := tz.Load(zone)
	if !ok {
		return nil, localdate.ErrInvalidTimeValue
	}
	if windowDays == 0 {
		windowDays = settings.PreferredWindowDays
	}

	// resolveWindowRange; an unparsable date became an Invalid Date that the
	// first timestamp parameter could not serialize.
	if from == "" || to == "" {
		end := s.Now().In(loc)
		if to != "" {
			t, ok := luxon.FromISO(to, loc, s.Now())
			if !ok {
				return nil, localdate.ErrInvalidTimeValue
			}
			end = t
		}
		to = luxon.ISODate(end)
		from = addDays(to, -(windowDays - 1))
	}
	start, ok1 := s.LocalStartUTC(from, loc)
	endDay, ok2 := s.LocalStartUTC(to, loc)
	if !ok1 || !ok2 {
		return nil, localdate.ErrInvalidTimeValue
	}
	endExclusive := localdate.StartOfDay(endDay.AddDate(0, 0, 1), loc)

	diary, err := s.diary(ctx, uid, from, to)
	if err != nil {
		return nil, err
	}
	meds, err := s.intakes(ctx, uid, start, endExclusive)
	if err != nil {
		return nil, err
	}
	current := ComputeForRange(zone, windowDays, from, to, diary, meds)
	out := current.object()

	var bFrom, bTo string
	switch {
	case settings.BaselineStart != nil:
		bFrom = localdate.String(*settings.BaselineStart, zone)
		bTo = addDays(bFrom, windowDays-1)
	case settings.BaselineEnd != nil:
		bTo = localdate.String(*settings.BaselineEnd, zone)
		bFrom = addDays(bTo, -(windowDays - 1))
	default:
		return out, nil
	}
	bDiary, err := s.diary(ctx, uid, bFrom, bTo)
	if err != nil {
		return nil, err
	}
	baseline := ComputeForRange(zone, windowDays, bFrom, bTo, bDiary, nil)
	out.Set("baseline", httpx.O("from", bFrom, "to", bTo, "mmd", baseline.Totals.MmdMin, "mhd", baseline.Totals.MhdMin))

	cov := func(c Coverage) float64 { return float64(c.RecordedDays) / float64(max(1, c.TotalDays)) }
	if cov(current.Totals.Coverage) < responderMinCoverage || cov(baseline.Totals.Coverage) < responderMinCoverage {
		out.Set("responder50", httpx.O("status", "NA", "reason", "INSUFFICIENT_COVERAGE"))
		return out, nil
	}
	r := ComputeResponder50(baseline.Totals.MmdMin, current.Totals.MmdMin)
	if r.Status == "NA" {
		out.Set("responder50", httpx.O("status", "NA"))
	} else {
		out.Set("responder50", httpx.O("status", r.Status, "baselineMmd", r.BaselineMmd, "currentMmd", r.CurrentMmd))
	}
	return out, nil
}

// Monthly is computeMonthly.
func (s *Service) Monthly(ctx context.Context, uid string, months int) (*httpx.Object, error) {
	zone, err := usertz.Get(ctx, s.Q, uid)
	if err != nil {
		return nil, err
	}
	loc := tz.LoadOrUTC(zone)
	months = max(1, min(36, months))
	now := s.Now().In(loc)
	monthStart := func(offset int) time.Time {
		return time.Date(now.Year(), now.Month()+time.Month(offset), 1, 0, 0, 0, 0, loc)
	}
	first := monthStart(-(months - 1))
	meds, err := s.intakes(ctx, uid, first, monthStart(1))
	if err != nil {
		return nil, err
	}
	lastDay := monthStart(1).AddDate(0, 0, -1)
	diary, err := s.diary(ctx, uid, first.Format(localdate.Layout), lastDay.Format(localdate.Layout))
	if err != nil {
		return nil, err
	}

	out := []any{}
	for i := 0; i < months; i++ {
		ms, next := monthStart(-(months-1)+i), monthStart(-(months-1)+i+1)
		from, to := ms.Format(localdate.Layout), next.AddDate(0, 0, -1).Format(localdate.Layout)
		var monthMeds []MedicationIntake
		for _, m := range meds {
			if !m.TakenAt.Before(ms) && m.TakenAt.Before(next) {
				monthMeds = append(monthMeds, m)
			}
		}
		var monthDiary []DiaryDay
		for _, d := range diary {
			if d.LocalDate >= from && d.LocalDate <= to {
				monthDiary = append(monthDiary, d)
			}
		}
		c := ComputeForRange(zone, 0, from, to, monthDiary, monthMeds)
		out = append(out, httpx.O("month", ms.Format("2006-01"), "mmd", c.Totals.MmdMin, "mmdMax", c.Totals.MmdMax,
			"mhd", c.Totals.MhdMin, "mhdMax", c.Totals.MhdMax, "acuteMedicationDays", c.Totals.AcuteMedicationDays,
			"coverage", c.Totals.Coverage))
	}
	return httpx.O("timezone", zone, "months", out), nil
}

// RangeTotals is computeOutcomes for an explicit valid from..to window,
// returning only the current totals (what the clinician report reads).
func (s *Service) RangeTotals(ctx context.Context, uid, zone, from, to string, windowDays int) (Totals, error) {
	loc := tz.LoadOrUTC(zone)
	start, _ := s.LocalStartUTC(from, loc)
	endDay, _ := s.LocalStartUTC(to, loc)
	diary, err := s.diary(ctx, uid, from, to)
	if err != nil {
		return Totals{}, err
	}
	meds, err := s.intakes(ctx, uid, start, localdate.StartOfDay(endDay.AddDate(0, 0, 1), loc))
	if err != nil {
		return Totals{}, err
	}
	return ComputeForRange(zone, windowDays, from, to, diary, meds).Totals, nil
}
