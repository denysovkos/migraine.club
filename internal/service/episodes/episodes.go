// Package episodes is EpisodeService: attacks and their derived data.
package episodes

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/diary"
	"github.com/denysovkos/migraine.club/internal/service/programs"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/service/wpi"
	"github.com/denysovkos/migraine.club/internal/zod"
)

// Enum values from src/types/Episode.ts, in declaration order.
var (
	PainLocations = []string{"LEFT", "RIGHT", "FRONTAL", "OCCIPITAL", "WHOLE_HEAD", "OTHER"}
	PainTypes     = []string{"THROBBING", "STABBING", "PRESSURE", "BURNING", "OTHER"}
	Symptoms      = []string{"NAUSEA", "VOMITING", "PHOTOPHOBIA", "PHONOPHOBIA", "AURA", "DIZZINESS", "NECK_PAIN", "OTHER"}
	Triggers      = []string{"STRESS", "SLEEP_ISSUE", "FOOD", "SKIPPED_MEAL", "DEHYDRATION", "CAFFEINE", "ALCOHOL", "HORMONES", "SCREEN_TIME", "WEATHER", "EXERCISE", "OTHER"}
	Protectors    = []string{"GOOD_SLEEP", "HYDRATION", "REGULAR_MEALS", "REST", "EXERCISE", "SCREEN_BREAKS", "ACUTE_MED_EARLY", "PREVENTIVE_TAKEN", "CALM_LOW_STRESS", "OTHER"}
)

// Error is EpisodeError.
type Error struct {
	Code    string
	Message string
	Details *httpx.Object
}

func (e *Error) Error() string { return e.Message }

// AsPainLocation is asPainLocation: unknown values become OTHER.
func AsPainLocation(v string) string {
	if slices.Contains(PainLocations, v) {
		return v
	}
	return "OTHER"
}

// AsPainType is asPainType.
func AsPainType(v string) string {
	if slices.Contains(PainTypes, v) {
		return v
	}
	return "OTHER"
}

// FilterAllowed keeps the values of a jsonb string array that are allowed
// (asSymptoms, asTriggers, asProtectors). Non-string entries are dropped.
func FilterAllowed(raw json.RawMessage, allowed []string) []string {
	var arr []any
	_ = json.Unmarshal(raw, &arr)
	out := []string{}
	for _, v := range arr {
		if s, ok := v.(string); ok && slices.Contains(allowed, s) {
			out = append(out, s)
		}
	}
	return out
}

// DTO is the list/create shape (toEpisodeDTO), without intakes.
func DTO(ep q.Episode) *httpx.Object {
	return detail(ep, []any{}, nil)
}

// Detail is the GET/PATCH shape with intakes and the attack treatment model.
func Detail(ep q.Episode, intakes []any, treatment any) *httpx.Object {
	return detail(ep, intakes, treatment)
}

func detail(ep q.Episode, intakes []any, treatment any) *httpx.Object {
	o := httpx.O(
		"id", ep.ID,
		"userId", ep.UserID,
		"attackType", ep.AttackType,
		"startTime", ep.StartTime,
		"onsetAt", ep.OnsetAt,
		"endTime", ep.EndTime,
		"isOngoing", ep.IsOngoing,
		"intensity", ep.Intensity,
		"painLocation", AsPainLocation(ep.PainLocation),
		"painLocationOther", ep.PainLocationOther,
		"painType", AsPainType(ep.PainType),
		"painTypeOther", ep.PainTypeOther,
		"symptoms", FilterAllowed(ep.Symptoms, Symptoms),
		"symptomsOther", ep.SymptomsOther,
		"medicationIntakes", intakes,
	)
	if treatment != nil {
		o.Set("attackTreatment", treatment)
	}
	o.Set("triggers", FilterAllowed(ep.Triggers, Triggers))
	o.Set("protectors", FilterAllowed(ep.Protectors, Protectors))
	o.Set("triggersOther", ep.TriggersOther)
	o.Set("notes", ep.Notes)
	o.Set("weatherPainIndexId", ep.WeatherPainIndexID)
	o.Set("weatherContext", rawOrNull(ep.WeatherContext))
	o.Set("createdAt", ep.CreatedAt)
	o.Set("updatedAt", ep.UpdatedAt)
	return o
}

func rawOrNull(r json.RawMessage) any {
	if len(r) == 0 {
		return nil
	}
	return r
}

// ---------- schemas ----------

func endTimeRefinements(s zod.Schema) zod.Schema {
	s = zod.Refine(s, func(v any) bool {
		m := v.(map[string]any)
		if b, _ := m["isOngoing"].(bool); b {
			_, has := m["endTime"]
			return !has || m["endTime"] == ""
		}
		return true
	}, "endTime must be null when isOngoing is true", "endTime")
	return zod.Refine(s, func(v any) bool {
		m := v.(map[string]any)
		start, _ := m["startTime"].(string)
		end, _ := m["endTime"].(string)
		ongoing, _ := m["isOngoing"].(bool)
		if start != "" && end != "" && !ongoing {
			st, _ := jsontime.Parse(start)
			et, _ := jsontime.Parse(end)
			return !et.Before(st)
		}
		return true
	}, "endTime must be >= startTime", "endTime")
}

// QuickCreateSchema is QuickCreateEpisodeSchema.
var QuickCreateSchema = zod.Object(
	zod.F("mode", zod.Literal("quick")),
	zod.F("intensity", zod.Number().Int().Min(1).Max(5)),
	zod.F("attackType", zod.Optional(zod.Enum("migraine", "headache"))),
	zod.F("startTime", zod.Optional(zod.Nullable(zod.String().Datetime()))),
	zod.F("onsetAt", zod.Optional(zod.Nullable(zod.String().Datetime()))),
	zod.F("isOngoing", zod.Optional(zod.Boolean())),
)

// CreateSchema is CreateEpisodeSchema.
var CreateSchema = endTimeRefinements(zod.Object(
	zod.F("attackType", zod.Optional(zod.Enum("migraine", "headache"))),
	zod.F("startTime", zod.Optional(zod.String().Datetime())),
	zod.F("onsetAt", zod.Optional(zod.String().Datetime())),
	zod.F("endTime", zod.Optional(zod.String().Datetime())),
	zod.F("isOngoing", zod.Optional(zod.Boolean())),
	zod.F("intensity", zod.Number().Int().Min(1).Max(5)),
	zod.F("painLocation", zod.Enum(PainLocations...)),
	zod.F("painLocationOther", zod.Optional(zod.String().Max(200))),
	zod.F("painType", zod.Enum(PainTypes...)),
	zod.F("painTypeOther", zod.Optional(zod.String().Max(200))),
	zod.F("symptoms", zod.Default(zod.Array(zod.Enum(Symptoms...)), []any{})),
	zod.F("symptomsOther", zod.Optional(zod.String().Max(500))),
	zod.F("triggers", zod.Default(zod.Array(zod.Enum(Triggers...)), []any{})),
	zod.F("protectors", zod.Default(zod.Array(zod.Enum(Protectors...)), []any{})),
	zod.F("triggersOther", zod.Optional(zod.String().Max(500))),
	zod.F("notes", zod.Optional(zod.String().Max(2000))),
))

// UpdateSchema is UpdateEpisodeSchema.
var UpdateSchema = endTimeRefinements(zod.Object(
	zod.F("attackType", zod.Optional(zod.Enum("migraine", "headache"))),
	zod.F("startTime", zod.Optional(zod.String().Datetime())),
	zod.F("onsetAt", zod.Optional(zod.String().Datetime())),
	zod.F("endTime", zod.Optional(zod.String().Datetime())),
	zod.F("isOngoing", zod.Optional(zod.Boolean())),
	zod.F("endNow", zod.Optional(zod.Boolean())),
	zod.F("endedAt", zod.Optional(zod.String().Datetime())),
	zod.F("intensity", zod.Optional(zod.Number().Int().Min(1).Max(5))),
	zod.F("painLocation", zod.Optional(zod.Enum(PainLocations...))),
	zod.F("painLocationOther", zod.Optional(zod.String().Max(200))),
	zod.F("painType", zod.Optional(zod.Enum(PainTypes...))),
	zod.F("painTypeOther", zod.Optional(zod.String().Max(200))),
	zod.F("symptoms", zod.Optional(zod.Array(zod.Enum(Symptoms...)))),
	zod.F("symptomsOther", zod.Optional(zod.String().Max(500))),
	zod.F("triggers", zod.Optional(zod.Array(zod.Enum(Triggers...)))),
	zod.F("protectors", zod.Optional(zod.Array(zod.Enum(Protectors...)))),
	zod.F("triggersOther", zod.Optional(zod.String().Max(500))),
	zod.F("notes", zod.Optional(zod.String().Max(2000))),
))

// ---------- service ----------

// Service is EpisodeService.
type Service struct {
	Pool *pgxpool.Pool
	Q    *q.Queries
	Log  *slog.Logger
	WPI  *wpi.Service
	Now  func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// HasHealthDataConsent is EpisodeService.hasHealthDataConsent (only the
// health_data consent, unlike the shared helper).
func (s *Service) HasHealthDataConsent(ctx context.Context, userID string) (bool, error) {
	return s.Q.HasHealthDataConsentRow(ctx, userID)
}

// Ongoing returns the user's ongoing attack, if any.
func (s *Service) Ongoing(ctx context.Context, userID string) (*q.OngoingEpisodeRow, error) {
	row, err := s.Q.OngoingEpisode(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// resolveOngoingConflict enforces one ongoing attack; an ongoing headache is
// ended when a migraine starts.
func (s *Service) resolveOngoingConflict(ctx context.Context, userID, attackType string, start time.Time) error {
	existing, err := s.Ongoing(ctx, userID)
	if err != nil || existing == nil {
		return err
	}
	if existing.AttackType == "headache" && attackType == "migraine" {
		return s.Q.EndEpisodeAt(ctx, jsontime.Ptr(start), jsontime.New(s.now()), userID, existing.ID)
	}
	return &Error{Code: "ONGOING_EXISTS", Message: "An attack is already in progress.",
		Details: httpx.O("ongoing", httpx.O("episodeId", existing.ID, "attackType", existing.AttackType))}
}

// WeatherContext is computeEpisodeWeatherContext: best effort, never fails.
func (s *Service) WeatherContext(ctx context.Context, userID string, start time.Time) (*string, json.RawMessage) {
	if s.WPI == nil {
		return nil, nil
	}
	settings, err := s.WPI.Settings(ctx, userID)
	if err != nil || settings == nil {
		if err != nil {
			s.Log.Warn("Failed to compute WPI for episode", "userId", userID, "error", err)
		}
		return nil, nil
	}
	data, err := s.WPI.ComputeAndStore(ctx, userID, start)
	if err != nil {
		s.Log.Warn("Failed to compute WPI for episode", "userId", userID, "error", err)
		return nil, nil
	}
	b, _ := httpx.Marshal(httpx.O(
		"wpiScore", data.Result.Score,
		"wpiLevel", data.Result.Level,
		"kpIndex", data.KpIndex,
		"deltaPressure", data.Weather.DeltaPressure,
		"temperatureDeviation", data.Weather.TemperatureDeviation,
		"humidity", data.Weather.Humidity,
		"windSpeed", data.Weather.WindSpeed,
		"uvi", data.Weather.UVI,
		"components", data.Result.ComponentsValue(),
	))
	id := data.SnapshotID
	return &id, b
}

// RefreshDerived keeps the diary backbone and the insights cache consistent
// after a change. Failures are logged, never returned.
func (s *Service) RefreshDerived(ctx context.Context, userID string, ep q.Episode, previous *q.Episode, what string) {
	zone, err := usertz.Get(ctx, s.Q, userID)
	if err == nil {
		now := s.now()
		dates := TouchedDates(ep, zone, now)
		if previous != nil {
			dates = append(dates, TouchedDates(*previous, zone, now)...)
		}
		_, err = diary.Recompute(ctx, s.Q, userID, dates, zone, now)
	}
	if err != nil {
		s.Log.Warn("Failed to recompute diary day rows after "+what, "userId", userID, "error", err)
	}
	if err := s.Q.MarkInsightsStale(ctx, userID); err != nil {
		s.Log.Warn("Failed to mark insights cache stale after "+what, "userId", userID, "error", err)
	}
}

// TouchedDates are the local dates an episode touches.
func TouchedDates(ep q.Episode, zone string, now time.Time) []string {
	var end *time.Time
	if ep.EndTime != nil {
		e := ep.EndTime.Time
		end = &e
	}
	return diary.TouchedDates(ep.StartTime.Time, end, ep.IsOngoing, now, zone)
}

func parseTime(s *string, fallback time.Time) time.Time {
	if s == nil || *s == "" {
		return fallback
	}
	t, err := jsontime.Parse(*s)
	if err != nil {
		return fallback
	}
	return t
}

func strArray(v []string) json.RawMessage {
	if v == nil {
		v = []string{}
	}
	b, _ := httpx.Marshal(v)
	return b
}

// Create is create(): the quick body (mode 'quick') or the full body.
func (s *Service) Create(ctx context.Context, userID string, body any) (q.Episode, error) {
	ok, err := s.HasHealthDataConsent(ctx, userID)
	if err != nil {
		return q.Episode{}, err
	}
	if !ok {
		return q.Episode{}, &Error{Code: "CONSENT_REQUIRED",
			Message: "You must provide explicit consent for health data processing before logging episodes."}
	}
	if m, isObj := body.(map[string]any); isObj && m["mode"] == "quick" {
		return s.createQuick(ctx, userID, body)
	}
	return s.createFull(ctx, userID, body)
}

func (s *Service) createQuick(ctx context.Context, userID string, body any) (q.Episode, error) {
	var in struct {
		Intensity  int     `json:"intensity"`
		AttackType *string `json:"attackType"`
		StartTime  *string `json:"startTime"`
		OnsetAt    *string `json:"onsetAt"`
		IsOngoing  *bool   `json:"isOngoing"`
	}
	if err := zod.ParseInto(QuickCreateSchema, body, &in); err != nil {
		return q.Episode{}, err
	}
	start := parseTime(in.StartTime, s.now())
	onset := parseTime(in.OnsetAt, start)
	ongoing := in.IsOngoing == nil || *in.IsOngoing
	attackType := "migraine"
	if in.AttackType != nil {
		attackType = *in.AttackType
	}
	if ongoing {
		if err := s.resolveOngoingConflict(ctx, userID, attackType, start); err != nil {
			return q.Episode{}, err
		}
	}
	wpiID, weather := s.WeatherContext(ctx, userID, start)
	unspecified := "unspecified"
	ep, err := s.Q.InsertEpisode(ctx, q.InsertEpisodeParams{
		UserID: userID, StartTime: jsontime.New(start), OnsetAt: jsontime.Ptr(onset), IsOngoing: ongoing,
		AttackType: attackType, Intensity: int32(in.Intensity),
		PainLocation: "OTHER", PainLocationOther: &unspecified, PainType: "OTHER", PainTypeOther: &unspecified,
		Symptoms: strArray(nil), Triggers: strArray(nil), Protectors: strArray(nil),
		WeatherPainIndexID: wpiID, WeatherContext: weather,
	})
	if err != nil {
		return q.Episode{}, err
	}
	s.RefreshDerived(ctx, userID, ep, nil, "episode quick-create")
	s.Log.Info("Episode created (quick)", "episodeId", ep.ID, "userId", userID, "mode", "quick")
	return ep, nil
}

type fullInput struct {
	AttackType        *string  `json:"attackType"`
	StartTime         *string  `json:"startTime"`
	OnsetAt           *string  `json:"onsetAt"`
	EndTime           *string  `json:"endTime"`
	IsOngoing         *bool    `json:"isOngoing"`
	Intensity         int      `json:"intensity"`
	PainLocation      string   `json:"painLocation"`
	PainLocationOther *string  `json:"painLocationOther"`
	PainType          string   `json:"painType"`
	PainTypeOther     *string  `json:"painTypeOther"`
	Symptoms          []string `json:"symptoms"`
	SymptomsOther     *string  `json:"symptomsOther"`
	Triggers          []string `json:"triggers"`
	Protectors        []string `json:"protectors"`
	TriggersOther     *string  `json:"triggersOther"`
	Notes             *string  `json:"notes"`
}

func (s *Service) createFull(ctx context.Context, userID string, body any) (q.Episode, error) {
	var in fullInput
	if err := zod.ParseInto(CreateSchema, body, &in); err != nil {
		return q.Episode{}, err
	}
	start := parseTime(in.StartTime, s.now())
	onset := parseTime(in.OnsetAt, start)
	ongoing := in.IsOngoing != nil && *in.IsOngoing
	var end *jsontime.Time
	if !ongoing && in.EndTime != nil && *in.EndTime != "" {
		end = jsontime.Ptr(parseTime(in.EndTime, time.Time{}))
	}
	attackType := "migraine"
	if in.AttackType != nil && *in.AttackType == "headache" {
		attackType = "headache"
	}
	if ongoing {
		if err := s.resolveOngoingConflict(ctx, userID, attackType, start); err != nil {
			return q.Episode{}, err
		}
	}
	wpiID, weather := s.WeatherContext(ctx, userID, start)
	ep, err := s.Q.InsertEpisode(ctx, q.InsertEpisodeParams{
		UserID: userID, StartTime: jsontime.New(start), OnsetAt: jsontime.Ptr(onset), EndTime: end,
		IsOngoing: ongoing, AttackType: attackType, Intensity: int32(in.Intensity),
		PainLocation: in.PainLocation, PainLocationOther: in.PainLocationOther,
		PainType: in.PainType, PainTypeOther: in.PainTypeOther,
		Symptoms: strArray(in.Symptoms), SymptomsOther: in.SymptomsOther,
		Triggers: strArray(in.Triggers), Protectors: strArray(in.Protectors),
		TriggersOther: in.TriggersOther, Notes: in.Notes,
		WeatherPainIndexID: wpiID, WeatherContext: weather,
	})
	if err != nil {
		return q.Episode{}, err
	}
	s.Log.Info("Episode created", "episodeId", ep.ID, "userId", userID, "hasWpiContext", weather != nil)
	s.RefreshDerived(ctx, userID, ep, nil, "episode create")
	return ep, nil
}

// Get returns the user's episode, or nil.
func (s *Service) Get(ctx context.Context, userID string, id int32) (*q.Episode, error) {
	ep, err := s.Q.GetEpisode(ctx, id, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ep, nil
}

type updateInput struct {
	AttackType        *string   `json:"attackType"`
	StartTime         *string   `json:"startTime"`
	OnsetAt           *string   `json:"onsetAt"`
	EndTime           *string   `json:"endTime"`
	IsOngoing         *bool     `json:"isOngoing"`
	EndNow            *bool     `json:"endNow"`
	EndedAt           *string   `json:"endedAt"`
	Intensity         *int      `json:"intensity"`
	PainLocation      *string   `json:"painLocation"`
	PainLocationOther *string   `json:"painLocationOther"`
	PainType          *string   `json:"painType"`
	PainTypeOther     *string   `json:"painTypeOther"`
	Symptoms          *[]string `json:"symptoms"`
	SymptomsOther     *string   `json:"symptomsOther"`
	Triggers          *[]string `json:"triggers"`
	Protectors        *[]string `json:"protectors"`
	TriggersOther     *string   `json:"triggersOther"`
	Notes             *string   `json:"notes"`
}

// optTime is an optional field that, when present, sets a nullable time:
// "" (falsy) means null, as `value ? new Date(value) : null` did.
func optTime(s *string) *jsontime.Time {
	if s == nil || *s == "" {
		return nil
	}
	t, err := jsontime.Parse(*s)
	if err != nil {
		return nil
	}
	return jsontime.Ptr(t)
}

// ResolveEndNowTime is resolveEndNowTime.
func ResolveEndNowTime(endedAt *string, start, now time.Time) time.Time {
	if endedAt == nil || *endedAt == "" {
		return now
	}
	at, err := jsontime.Parse(*endedAt)
	if err != nil || at.After(now) {
		return now
	}
	if at.Before(start) {
		return start
	}
	return at
}

// Update is update(): the 30-day editing window for timeline and type
// changes, ongoing/endTime consistency, and the derived-data refresh.
func (s *Service) Update(ctx context.Context, userID string, id int32, body any) (q.Episode, error) {
	existing, err := s.Get(ctx, userID, id)
	if err != nil {
		return q.Episode{}, err
	}
	if existing == nil {
		return q.Episode{}, &Error{Code: "NOT_FOUND", Message: "Episode not found"}
	}
	var in updateInput
	if err := zod.ParseInto(UpdateSchema, body, &in); err != nil {
		return q.Episode{}, err
	}

	zone, err := usertz.Get(ctx, s.Q, userID)
	if err != nil {
		return q.Episode{}, err
	}
	touchesTimeline := in.StartTime != nil || in.EndTime != nil || in.IsOngoing != nil || in.AttackType != nil
	if touchesTimeline {
		anchor := existing.StartTime.Time
		if !existing.IsOngoing && existing.EndTime != nil {
			anchor = existing.EndTime.Time
		}
		if !localdate.IsEditable(localdate.String(anchor, zone), s.now(), zone) {
			return q.Episode{}, &Error{Code: "NOT_EDITABLE", Message: "This attack is outside the editing window (last 30 days)."}
		}
	}

	next := q.UpdateEpisodeParams{
		AttackType: existing.AttackType, StartTime: existing.StartTime, OnsetAt: existing.OnsetAt,
		EndTime: existing.EndTime, IsOngoing: existing.IsOngoing, Intensity: existing.Intensity,
		PainLocation: existing.PainLocation, PainLocationOther: existing.PainLocationOther,
		PainType: existing.PainType, PainTypeOther: existing.PainTypeOther,
		Symptoms: existing.Symptoms, SymptomsOther: existing.SymptomsOther,
		Triggers: existing.Triggers, Protectors: existing.Protectors,
		TriggersOther: existing.TriggersOther, Notes: existing.Notes,
		ID: id, UserID: userID,
	}
	// What the update sets explicitly (for the "final" values and refresh).
	var setStart, setOngoing, setEnd bool
	var newEnd *jsontime.Time

	endNow := in.EndNow != nil && *in.EndNow
	if endNow {
		next.IsOngoing, setOngoing = false, true
		t := ResolveEndNowTime(in.EndedAt, existing.StartTime.Time, s.now())
		newEnd, setEnd = jsontime.Ptr(t), true
	}
	if in.StartTime != nil {
		next.StartTime, setStart = jsontime.New(parseTime(in.StartTime, existing.StartTime.Time)), true
	}
	if in.OnsetAt != nil {
		next.OnsetAt = optTime(in.OnsetAt)
	}
	switch {
	case in.IsOngoing != nil && !endNow:
		next.IsOngoing, setOngoing = *in.IsOngoing, true
		if *in.IsOngoing {
			newEnd, setEnd = nil, true
		} else if in.EndTime != nil {
			newEnd, setEnd = optTime(in.EndTime), true
		}
	case in.EndTime != nil && !endNow:
		if existing.IsOngoing {
			return q.Episode{}, &Error{Code: "VALIDATION_ERROR", Message: "Cannot set endTime when episode is ongoing"}
		}
		newEnd, setEnd = optTime(in.EndTime), true
	}
	if setEnd {
		next.EndTime = newEnd
	}

	// finalEndTime = updateData.endTime ?? existing.endTime: a null update
	// falls back to the existing end for this check.
	finalEnd := existing.EndTime
	if setEnd && newEnd != nil {
		finalEnd = newEnd
	}
	if !next.IsOngoing && finalEnd != nil && finalEnd.Before(next.StartTime.Time) {
		return q.Episode{}, &Error{Code: "VALIDATION_ERROR", Message: "endTime must be >= startTime"}
	}

	if in.Intensity != nil {
		next.Intensity = int32(*in.Intensity)
	}
	if in.PainLocation != nil {
		next.PainLocation = *in.PainLocation
	}
	if in.PainLocationOther != nil {
		next.PainLocationOther = in.PainLocationOther
	}
	if in.PainType != nil {
		next.PainType = *in.PainType
	}
	if in.PainTypeOther != nil {
		next.PainTypeOther = in.PainTypeOther
	}
	if in.Symptoms != nil {
		next.Symptoms = strArray(*in.Symptoms)
	}
	if in.SymptomsOther != nil {
		next.SymptomsOther = in.SymptomsOther
	}
	if in.Triggers != nil {
		next.Triggers = strArray(*in.Triggers)
	}
	if in.Protectors != nil {
		next.Protectors = strArray(*in.Protectors)
	}
	if in.TriggersOther != nil {
		next.TriggersOther = in.TriggersOther
	}
	if in.Notes != nil {
		next.Notes = in.Notes
	}
	if in.AttackType != nil {
		next.AttackType = *in.AttackType
	}
	next.Now = jsontime.New(s.now())

	updated, err := s.Q.UpdateEpisode(ctx, next)
	if err != nil {
		return q.Episode{}, err
	}
	s.Log.Info("Episode updated", "episodeId", id, "userId", userID)

	if in.OnsetAt != nil || in.StartTime != nil {
		go func() {
			if err := programs.RecordAcuteAdherence(context.WithoutCancel(ctx), s.Q, userID, id, ""); err != nil {
				s.Log.Warn("Failed to refresh acute adherence after episode patch", "userId", userID, "episodeId", id, "error", err)
			}
		}()
	}
	if touchesTimeline || setStart || setEnd || setOngoing {
		s.RefreshDerived(ctx, userID, updated, existing, "episode update")
	}
	return updated, nil
}

// ListResult is ListEpisodesResult.
type ListResult struct {
	Episodes    []q.Episode
	Page, Limit float64
	Total       int
}

// errBigintRange is what Postgres answered when Drizzle sent a LIMIT or
// OFFSET beyond bigint.
var errBigintRange = errors.New("value out of range for type bigint")

// List is list(): newest first, from/to applied to start_time. page and
// limit are the parseInt results (NaN when absent or unparsable).
func (s *Service) List(ctx context.Context, userID string, page, limit float64, from, to *time.Time) (ListResult, error) {
	if !(page > 0) {
		page = 1
	}
	if !(limit > 0) {
		limit = 20
	}
	offset := (page - 1) * limit
	if limit >= math.MaxInt64 || offset >= math.MaxInt64 {
		return ListResult{}, errBigintRange
	}
	var f, t *jsontime.Time
	if from != nil {
		f = jsontime.Ptr(*from)
	}
	if to != nil {
		t = jsontime.Ptr(*to)
	}
	rows, err := s.Q.ListEpisodes(ctx, q.ListEpisodesParams{UserID: userID, FromTime: f, ToTime: t, Lim: int64(limit), Off: int64(offset)})
	if err != nil {
		return ListResult{}, err
	}
	total, err := s.Q.CountEpisodes(ctx, userID, f, t)
	if err != nil {
		return ListResult{}, err
	}
	return ListResult{Episodes: rows, Page: page, Limit: limit, Total: int(total)}, nil
}

// TotalPages is Math.ceil(total / limit).
func (r ListResult) TotalPages() float64 { return math.Ceil(float64(r.Total) / r.Limit) }
