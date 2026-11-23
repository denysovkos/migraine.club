package episodes

import (
	"context"
	"time"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/zod"
)

// Relief exercises and answers (src/types/Relief.ts).
var (
	ReliefExercises     = []string{"breathing", "pmr", "relaxation"}
	ReliefHelpedChoices = []string{"yes", "a_little", "no"}
)

// ReliefMaxDurationSeconds is the longest session accepted.
const ReliefMaxDurationSeconds = 60 * 60

// CreateReliefSessionSchema is CreateReliefSessionSchema.
var CreateReliefSessionSchema = zod.Object(
	zod.F("exercise", zod.Enum(ReliefExercises...)),
	zod.F("startedAt", zod.String().Datetime()),
	zod.F("durationSeconds", zod.Number().Int().Min(0).Max(ReliefMaxDurationSeconds)),
	zod.F("completed", zod.Boolean()),
	zod.F("helped", zod.Optional(zod.Nullable(zod.Enum(ReliefHelpedChoices...)))),
	zod.F("episodeId", zod.Optional(zod.Nullable(zod.Number().Int().Positive()))),
)

func reliefDTO(r q.ReliefSession) *httpx.Object {
	return httpx.O("id", r.ID, "episodeId", r.EpisodeID, "exercise", r.Exercise, "startedAt", jsontime.Format(r.StartedAt.Time),
		"durationSeconds", r.DurationSeconds, "completed", r.Completed, "helped", r.Helped)
}

// AddReliefSession is ReliefSessionService.add.
func (s *Service) AddReliefSession(ctx context.Context, userID string, body any) (*httpx.Object, error) {
	ok, err := s.HasHealthDataConsent(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, &Error{Code: "CONSENT_REQUIRED", Message: "You must provide explicit consent for health data processing before logging episodes."}
	}
	var in struct {
		Exercise        string  `json:"exercise"`
		StartedAt       string  `json:"startedAt"`
		DurationSeconds int32   `json:"durationSeconds"`
		Completed       bool    `json:"completed"`
		Helped          *string `json:"helped"`
		EpisodeID       *int32  `json:"episodeId"`
	}
	if err := zod.ParseInto(CreateReliefSessionSchema, body, &in); err != nil {
		return nil, err
	}
	started, _ := jsontime.Parse(in.StartedAt)
	if started.After(s.now().Add(5 * time.Minute)) {
		return nil, &Error{Code: "VALIDATION_ERROR", Message: "The session starts in the future.", Details: httpx.O("reason", "in_future")}
	}
	if in.EpisodeID != nil {
		ep, err := s.Get(ctx, userID, *in.EpisodeID)
		if err != nil {
			return nil, err
		}
		if ep == nil {
			return nil, &Error{Code: "NOT_FOUND", Message: "Episode not found"}
		}
	}
	row, err := s.Q.InsertReliefSession(ctx, q.InsertReliefSessionParams{
		UserID: userID, EpisodeID: in.EpisodeID, Exercise: in.Exercise, StartedAt: jsontime.New(started),
		DurationSeconds: in.DurationSeconds, Completed: in.Completed, Helped: in.Helped,
	})
	if err != nil {
		return nil, err
	}
	return reliefDTO(row), nil
}

// ListReliefSessions is ReliefSessionService.list.
func (s *Service) ListReliefSessions(ctx context.Context, userID string, episodeID *int32) ([]any, error) {
	rows, err := s.Q.ListReliefSessions(ctx, userID, episodeID)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = reliefDTO(r)
	}
	return out, nil
}
