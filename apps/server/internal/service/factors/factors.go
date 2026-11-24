// Package factors logs triggers, protectors and symptoms, and lists the
// options the factor picker shows.
package factors

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

// BuiltIn is a built-in factor of the picker (factorCatalog.ts).
type BuiltIn struct{ Key, Type, TranslationKey string }

// BuiltIns lists triggers then protectors, in catalog order.
var BuiltIns = []BuiltIn{
	{"sleep_issue", "trigger", "builtins.trigger.sleep_issue"},
	{"stress", "trigger", "builtins.trigger.stress"},
	{"skipped_meal", "trigger", "builtins.trigger.skipped_meal"},
	{"dehydration", "trigger", "builtins.trigger.dehydration"},
	{"caffeine", "trigger", "builtins.trigger.caffeine"},
	{"alcohol", "trigger", "builtins.trigger.alcohol"},
	{"screen_time", "trigger", "builtins.trigger.screen_time"},
	{"weather", "trigger", "builtins.trigger.weather"},
	{"hormones", "trigger", "builtins.trigger.hormones"},
	{"exercise", "trigger", "builtins.trigger.exercise"},
	{"other", "trigger", "builtins.trigger.other"},
	{"good_sleep", "protector", "builtins.protector.good_sleep"},
	{"hydration", "protector", "builtins.protector.hydration"},
	{"regular_meals", "protector", "builtins.protector.regular_meals"},
	{"rest", "protector", "builtins.protector.rest"},
	{"physical_activity", "protector", "builtins.protector.exercise"},
	{"screen_breaks", "protector", "builtins.protector.screen_breaks"},
	{"acute_med_early", "protector", "builtins.protector.acute_med_early"},
	{"preventive_taken", "protector", "builtins.protector.preventive_taken"},
	{"calm_low_stress", "protector", "builtins.protector.calm_low_stress"},
	{"other_protector", "protector", "builtins.protector.other"},
}

// LogSchema is LogFactorSchema.
var LogSchema = zod.Object(
	zod.F("displayName", zod.String().Trim().Min(1).Max(80)),
	zod.F("type", zod.Enum("trigger", "protector", "symptom")),
	zod.F("occurredAt", zod.Optional(zod.String().Datetime())),
)

// ErrConsent is FactorError('CONSENT_REQUIRED').
var ErrConsent = errors.New("Health data consent required")

// Service logs factors and lists options.
type Service struct {
	Pool *pgxpool.Pool
	Q    *q.Queries
	Now  func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// LogInput is LogFactorInput.
type LogInput struct {
	DisplayName string  `json:"displayName"`
	Type        string  `json:"type"`
	OccurredAt  *string `json:"occurredAt"`
}

// Log is FactorService.log: reuse the active factor with that name and type,
// then append an event, in one transaction.
func (s *Service) Log(ctx context.Context, userID string, in LogInput) (factorID, eventID string, occurredAt time.Time, err error) {
	ok, err := consent.HasHealthDataConsent(ctx, s.Q, userID)
	if err != nil {
		return "", "", time.Time{}, err
	}
	if !ok {
		return "", "", time.Time{}, ErrConsent
	}
	at := s.now()
	if in.OccurredAt != nil && *in.OccurredAt != "" {
		if t, perr := jsontime.Parse(*in.OccurredAt); perr == nil {
			at = t
		}
	}
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		qtx := s.Q.WithTx(tx)
		id, err := qtx.ActiveFactorID(ctx, &userID, in.DisplayName, in.Type)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if id, err = qtx.InsertFactor(ctx, &userID, in.Type, in.DisplayName); err != nil {
				return err
			}
		case err != nil:
			return err
		}
		ev, err := qtx.InsertFactorEvent(ctx, userID, id, jsontime.New(at))
		if err != nil {
			return err
		}
		factorID, eventID, occurredAt = id, ev.ID, ev.OccurredAt.Time
		return nil
	})
	return factorID, eventID, occurredAt, err
}

func token(key *string, name string) string {
	if key != nil {
		if t := strings.ToLower(jsx.Trim(*key)); t != "" {
			return t
		}
	}
	return strings.ToLower(jsx.Trim(name))
}

// ErrInvalidLocalDate is resolveLocalDate's error.
var ErrInvalidLocalDate = errors.New("Invalid localDate")

// Options is FactorOptionsService.getOptions.
func (s *Service) Options(ctx context.Context, userID, ymd string) (*httpx.Object, error) {
	zone, err := usertz.Get(ctx, s.Q, userID)
	if err != nil {
		return nil, err
	}
	loc, ok := tz.Load(zone)
	if ymd == "" {
		ymd = localdate.String(s.now(), zone)
	} else if !ok {
		return nil, ErrInvalidLocalDate
	}
	if loc == nil {
		loc = time.UTC
	}
	day, ok := localdate.ParseInZone(ymd, loc)
	if !ok {
		return nil, ErrInvalidLocalDate
	}
	next := day.AddDate(0, 0, 1)
	next = time.Date(next.Year(), next.Month(), next.Day(), 0, 0, 0, 0, loc)

	recentRows, err := s.Q.RecentFactors(ctx, userID)
	if err != nil {
		return nil, err
	}
	logged, err := s.Q.LoggedFactorsBetween(ctx, userID, jsontime.New(day), jsontime.New(next))
	if err != nil {
		return nil, err
	}
	loggedSet := map[string]bool{}
	for _, r := range logged {
		if t := token(r.Key, r.DisplayName); t != "" {
			loggedSet[r.Type+":"+t] = true
		}
	}
	type recent struct {
		obj        *httpx.Object
		typ, token string
	}
	var recents []recent
	seen := map[string]bool{}
	for _, r := range recentRows {
		if seen[r.FactorID] {
			continue
		}
		seen[r.FactorID] = true
		recents = append(recents, recent{
			obj:   httpx.O("factorId", r.FactorID, "displayName", r.DisplayName, "type", r.Type, "key", r.Key),
			typ:   r.Type,
			token: token(r.Key, r.DisplayName),
		})
	}
	group := func(typ string) *httpx.Object {
		builtIns := []any{}
		tokens := map[string]bool{}
		for _, b := range BuiltIns {
			if b.Type != typ {
				continue
			}
			tokens[b.Key] = true
			builtIns = append(builtIns, httpx.O("key", b.Key, "type", b.Type, "translationKey", b.TranslationKey,
				"logged", loggedSet[b.Type+":"+b.Key]))
		}
		out := []any{}
		for _, r := range recents {
			if r.typ == typ && (r.token == "" || !tokens[r.token]) {
				out = append(out, r.obj)
			}
		}
		return httpx.O("builtIns", builtIns, "recent", out)
	}
	return httpx.O("trigger", group("trigger"), "protector", group("protector")), nil
}
