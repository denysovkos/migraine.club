// Package pressure is src/services/pressure: the multi-day pressure outlook
// and the pressure-drop alert threshold.
package pressure

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/wpi"
)

// Thresholds from pressureOutlook.ts.
const (
	DefaultHighlightHpa = 5
	MinThresholdHpa     = 1
	MaxThresholdHpa     = 30
	OutlookDays         = 6
	// TTL is PRESSURE_FORECAST_TTL_MS.
	TTL = 3 * time.Hour
)

func roundCoord(c float64) float64 { return jsx.Round(c*100) / 100 }

func round1(n float64) float64 { return jsx.Round(n*10) / 10 }

// Day is PressureOutlookDay.
type Day struct {
	Date                   string `json:"date"`
	PressureHpa            num    `json:"pressureHpa"`
	ChangeHpa              *num   `json:"changeHpa"`
	DropAtOrAboveThreshold bool   `json:"dropAtOrAboveThreshold"`
}

type num float64

func (n num) MarshalJSON() ([]byte, error) { return []byte(jsx.FormatNumber(float64(n))), nil }

// BuildOutlook is buildPressureOutlook.
func BuildOutlook(points []wpi.PressurePoint, zone string, threshold float64, today string, days int) []Day {
	sorted := make([]wpi.PressurePoint, 0, len(points))
	for _, p := range points {
		if jsx.IsFinite(p.Dt) && jsx.IsFinite(p.PressureHpa) {
			sorted = append(sorted, p)
		}
	}
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Dt < sorted[j].Dt })
	byDate := map[string]float64{}
	var dates []string
	for _, p := range sorted {
		d := localdate.String(time.UnixMilli(int64(p.Dt*1000)), zone)
		if _, ok := byDate[d]; !ok {
			byDate[d] = p.PressureHpa
			dates = append(dates, d)
		}
	}
	sort.Strings(dates)
	out := []Day{}
	var prev *float64
	for _, d := range dates {
		pressure := byDate[d]
		var change *num
		if prev != nil {
			c := num(round1(pressure - *prev))
			change = &c
		}
		p := pressure
		prev = &p
		if d < today {
			continue
		}
		out = append(out, Day{Date: d, PressureHpa: num(round1(pressure)), ChangeHpa: change,
			DropAtOrAboveThreshold: change != nil && -float64(*change) >= threshold})
		if len(out) >= days {
			break
		}
	}
	return out
}

// Service is PressureForecastService.
type Service struct {
	Q   *q.Queries
	WPI *wpi.Service
	Now func() time.Time
}

// Settings is getSettings; nil without weather settings.
func (s *Service) Settings(ctx context.Context, uid string) (*q.UserWeatherSetting, error) {
	r, err := s.Q.GetWeatherSettings(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// SetThreshold is setThreshold; false when the user has no location.
func (s *Service) SetThreshold(ctx context.Context, uid string, threshold *float64) (bool, error) {
	ids, err := s.Q.SetPressureThreshold(ctx, threshold, jsontime.New(s.Now()), uid)
	return len(ids) > 0, err
}

// ForecastPoints is getForecastPoints: fresh cache, else provider, else stale.
func (s *Service) ForecastPoints(ctx context.Context, lat, lon float64, now time.Time) ([]wpi.PressurePoint, error) {
	rLat, rLon := roundCoord(lat), roundCoord(lon)
	cached, err := s.Q.PressureForecastCache(ctx, rLat, rLon)
	hasCache := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var cachedPoints []wpi.PressurePoint
	if hasCache {
		_ = json.Unmarshal(cached.Points, &cachedPoints)
		if now.Sub(cached.FetchedAt.Time) < TTL {
			return cachedPoints, nil
		}
	}
	fresh := s.WPI.DailyPressureForecast(ctx, rLat, rLon)
	if len(fresh) == 0 {
		if cachedPoints == nil {
			return []wpi.PressurePoint{}, nil
		}
		return cachedPoints, nil
	}
	b, _ := json.Marshal(fresh)
	if err := s.Q.UpsertPressureForecastCache(ctx, rLat, rLon, b, jsontime.New(now)); err != nil && s.WPI.Log != nil {
		s.WPI.Log.Warn("Failed to cache pressure forecast", "error", err)
	}
	return fresh, nil
}

// Outlook is getOutlookForSettings.
func (s *Service) Outlook(ctx context.Context, st *q.UserWeatherSetting) (*httpx.Object, error) {
	days, err := s.OutlookDays(ctx, st.Lat, st.Lon, st.Timezone, st.PressureDropThresholdHpa, s.Now())
	if err != nil {
		return nil, err
	}
	highlight := float64(DefaultHighlightHpa)
	var alert any
	if st.PressureDropThresholdHpa != nil {
		highlight = *st.PressureDropThresholdHpa
		alert = num(highlight)
	}
	return httpx.O("timezone", st.Timezone, "alertThresholdHpa", alert, "highlightThresholdHpa", num(highlight), "days", days), nil
}

// OutlookDays is the days of getOutlookForSettings.
func (s *Service) OutlookDays(ctx context.Context, lat, lon float64, zone string, threshold *float64, now time.Time) ([]Day, error) {
	points, err := s.ForecastPoints(ctx, lat, lon, now)
	if err != nil {
		return nil, err
	}
	highlight := float64(DefaultHighlightHpa)
	if threshold != nil {
		highlight = *threshold
	}
	return BuildOutlook(points, zone, highlight, localdate.String(now, zone), OutlookDays), nil
}

// AlertHorizonDays is ALERT_HORIZON_DAYS.
const AlertHorizonDays = 2

// FindUpcomingDrop is findUpcomingDrop: the first day after today, within
// the horizon, whose fall meets the threshold.
func FindUpcomingDrop(days []Day, today string, horizon int) *Day {
	t, err := time.Parse(localdate.Layout, today)
	if err != nil {
		return nil
	}
	last := t.AddDate(0, 0, horizon).Format(localdate.Layout)
	for i := range days {
		if days[i].Date > today && days[i].Date <= last && days[i].DropAtOrAboveThreshold {
			return &days[i]
		}
	}
	return nil
}

// Change is the day's change in hPa; ok is false when there is none.
func (d Day) Change() (float64, bool) {
	if d.ChangeHpa == nil {
		return 0, false
	}
	return float64(*d.ChangeHpa), true
}
