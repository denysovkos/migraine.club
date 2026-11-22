package episodes

import (
	"context"
	"time"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/tz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

// Pain reading scale and clock skew (painTimeline.ts).
const (
	PainReadingMin = 1
	PainReadingMax = 5
	FutureSkew     = 5 * time.Minute
)

// CreatePainReadingSchema is CreatePainReadingSchema.
var CreatePainReadingSchema = zod.Object(
	zod.F("intensity", zod.Number().Int().Min(PainReadingMin).Max(PainReadingMax)),
	zod.F("recordedAt", zod.Optional(zod.Nullable(zod.String().Datetime()))),
)

// AttackWindow is the span a reading must fall into.
type AttackWindow struct {
	Start time.Time
	End   *time.Time
}

// WindowOf is attackWindow: the reported onset when it is earlier, no end
// while ongoing.
func WindowOf(ep q.Episode) AttackWindow {
	start := ep.StartTime.Time
	if ep.OnsetAt != nil && ep.OnsetAt.Before(start) {
		start = ep.OnsetAt.Time
	}
	w := AttackWindow{Start: start}
	if !ep.IsOngoing && ep.EndTime != nil {
		e := ep.EndTime.Time
		w.End = &e
	}
	return w
}

// CheckReadingTime is checkReadingTime ("" when the time is fine).
func CheckReadingTime(at time.Time, w AttackWindow, now time.Time) string {
	switch {
	case at.Before(w.Start):
		return "before_start"
	case w.End != nil && at.After(*w.End):
		return "after_end"
	case at.After(now.Add(FutureSkew)):
		return "in_future"
	}
	return ""
}

var readingTimeMessages = map[string]string{
	"before_start": "The reading is before the attack started.",
	"after_end":    "The reading is after the attack ended.",
	"in_future":    "The reading is in the future.",
}

// MidnightsBetween is midnightsBetween: local midnights in (from, to], at
// most 60.
func MidnightsBetween(from, to time.Time, zone string) []time.Time {
	if !to.After(from) {
		return nil
	}
	loc := tz.LoadOrUTC(zone)
	next := localdate.StartOfDay(from, loc).AddDate(0, 0, 1)
	next = time.Date(next.Year(), next.Month(), next.Day(), 0, 0, 0, 0, loc)
	var out []time.Time
	for !next.After(to) && len(out) < 60 {
		out = append(out, next)
		n := next.AddDate(0, 0, 1)
		next = time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, loc)
	}
	return out
}

func readingDTO(r q.EpisodePainReading) *httpx.Object {
	return httpx.O("id", r.ID, "episodeId", r.EpisodeID, "recordedAt", jsontime.Format(r.RecordedAt.Time), "intensity", r.Intensity)
}

func (s *Service) requireEpisode(ctx context.Context, userID string, id int32) (q.Episode, error) {
	ep, err := s.Get(ctx, userID, id)
	if err != nil {
		return q.Episode{}, err
	}
	if ep == nil {
		return q.Episode{}, &Error{Code: "NOT_FOUND", Message: "Episode not found"}
	}
	return *ep, nil
}

// ListPainReadings returns the attack's readings, oldest first.
func (s *Service) ListPainReadings(ctx context.Context, userID string, id int32) ([]any, error) {
	if _, err := s.requireEpisode(ctx, userID, id); err != nil {
		return nil, err
	}
	rows, err := s.Q.ListPainReadings(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = readingDTO(r)
	}
	return out, nil
}

// AddPainReading is PainReadingService.add.
func (s *Service) AddPainReading(ctx context.Context, userID string, id int32, body any) (*httpx.Object, error) {
	ok, err := s.HasHealthDataConsent(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, &Error{Code: "CONSENT_REQUIRED", Message: "You must provide explicit consent for health data processing before logging episodes."}
	}
	var in struct {
		Intensity  int     `json:"intensity"`
		RecordedAt *string `json:"recordedAt"`
	}
	if err := zod.ParseInto(CreatePainReadingSchema, body, &in); err != nil {
		return nil, err
	}
	ep, err := s.requireEpisode(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	now := s.now()
	at := parseTime(in.RecordedAt, now)
	if reason := CheckReadingTime(at, WindowOf(ep), now); reason != "" {
		return nil, &Error{Code: "VALIDATION_ERROR", Message: readingTimeMessages[reason], Details: httpx.O("reason", reason)}
	}
	row, err := s.Q.InsertPainReading(ctx, userID, id, jsontime.New(at), int32(in.Intensity))
	if err != nil {
		return nil, err
	}
	peak, err := s.syncPeak(ctx, userID, id, ep.Intensity)
	if err != nil {
		return nil, err
	}
	p := ep.Intensity
	if peak != nil {
		p = *peak
	}
	return httpx.O("reading", readingDTO(row), "peakIntensity", p), nil
}

func (s *Service) syncPeak(ctx context.Context, userID string, id, current int32) (*int32, error) {
	// Intensities are 1–5, so 0 means "no readings" (max() is NULL).
	peak, err := s.Q.PeakPainReading(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if peak == 0 {
		return nil, nil
	}
	if peak != current {
		if _, err := s.Update(ctx, userID, id, map[string]any{"intensity": float64(peak)}); err != nil {
			return nil, err
		}
	}
	return &peak, nil
}

// RemovePainReading deletes one reading and returns the peak afterwards.
func (s *Service) RemovePainReading(ctx context.Context, userID string, id int32, readingID string) (*int32, error) {
	ep, err := s.requireEpisode(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	deleted, err := s.Q.DeletePainReading(ctx, readingID, userID, id)
	if err != nil {
		return nil, err
	}
	if len(deleted) == 0 {
		return nil, &Error{Code: "NOT_FOUND", Message: "Pain reading not found"}
	}
	return s.syncPeak(ctx, userID, id, ep.Intensity)
}
