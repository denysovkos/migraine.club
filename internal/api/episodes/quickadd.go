package episodes

import (
	"net/http"
	"time"

	"github.com/denysovkos/migraine.club/internal/api/idem"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/localdate"
	"github.com/denysovkos/migraine.club/internal/service/consent"
	"github.com/denysovkos/migraine.club/internal/service/diary"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/tz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var quickEpisodeBody = zod.Object(
	zod.F("attackType", zod.Optional(zod.Enum("migraine", "headache"))),
	zod.F("localDate", zod.Optional(zod.String().Regex(`^\d{4}-\d{2}-\d{2}$`))),
	zod.F("onsetAt", zod.Optional(zod.Nullable(zod.String().Datetime()))),
	zod.F("startedAt", zod.Optional(zod.String().Datetime())),
)

func placeholder(userID string, start time.Time, onset *time.Time, end *time.Time, ongoing bool, attackType string, wpiID *string, weather []byte) q.InsertEpisodeParams {
	unspecified := "unspecified"
	o := start
	if onset != nil {
		o = *onset
	}
	var e *jsontime.Time
	if end != nil {
		e = jsontime.Ptr(*end)
	}
	return q.InsertEpisodeParams{
		UserID: userID, StartTime: jsontime.New(start), OnsetAt: jsontime.Ptr(o), EndTime: e,
		IsOngoing: ongoing, AttackType: attackType, Intensity: 3,
		PainLocation: "OTHER", PainLocationOther: &unspecified, PainType: "OTHER", PainTypeOther: &unspecified,
		Symptoms: []byte("[]"), Triggers: []byte("[]"), Protectors: []byte("[]"),
		WeatherPainIndexID: wpiID, WeatherContext: weather,
	}
}

// POST /api/quick-add/episode
func (h handlers) quickEpisode(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	idem.Wrap(h.d.Q, h.d.Log, h.d.Clock, w, r, userID, "quick-add/episode", func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		ok, err := consent.HasHealthDataConsent(ctx, h.d.Q, userID)
		if err != nil {
			httpx.Unhandled(w)
			return
		}
		if !ok {
			httpx.JSON(w, http.StatusForbidden, httpx.O("error", "Health data consent required", "code", "CONSENT_REQUIRED",
				"message", "You must provide explicit consent for health data processing before logging."))
			return
		}
		now := h.d.Clock()
		body := httpx.ReadJSONOr(r, map[string]any{})
		var in struct {
			AttackType *string `json:"attackType"`
			LocalDate  *string `json:"localDate"`
			OnsetAt    *string `json:"onsetAt"`
			StartedAt  *string `json:"startedAt"`
		}
		if err := zod.ParseInto(quickEpisodeBody, body, &in); err != nil {
			httpx.ValidationError(w, err.(*zod.Error))
			return
		}
		attackType := "migraine"
		if in.AttackType != nil && *in.AttackType == "headache" {
			attackType = "headache"
		}
		var onset *time.Time
		if in.OnsetAt != nil && *in.OnsetAt != "" {
			if t, err := jsontime.Parse(*in.OnsetAt); err == nil {
				onset = &t
			}
		}

		if in.LocalDate != nil && *in.LocalDate != "" {
			h.historical(w, r, userID, *in.LocalDate, attackType, onset)
			return
		}

		var startedAt string
		if in.StartedAt != nil {
			startedAt = *in.StartedAt
		}
		start, msg := idem.ResolveCapturedAt(startedAt, now, 7, 0)
		if msg != "" {
			httpx.JSON(w, http.StatusBadRequest, httpx.O("error", msg, "code", "INVALID_STARTED_AT"))
			return
		}
		existing, err := h.svc.Ongoing(ctx, userID)
		if err != nil {
			httpx.Unhandled(w)
			return
		}
		recompute := func(dates []string, what string) {
			zone, err := usertz.Get(ctx, h.d.Q, userID)
			if err == nil {
				_, err = diary.Recompute(ctx, h.d.Q, userID, dates, zone, h.d.Clock())
			}
			if err != nil {
				h.d.Log.Warn("Failed to recompute diary day rows after "+what, "userId", userID, "error", err)
			}
		}

		if existing != nil && existing.AttackType == "headache" && attackType == "migraine" {
			wpiID, weather := h.svc.WeatherContext(ctx, userID, start)
			var createdID int32
			tx, err := h.d.Pool.Begin(ctx)
			if err != nil {
				httpx.Unhandled(w)
				return
			}
			qtx := h.d.Q.WithTx(tx)
			err = qtx.EndEpisodeAt(ctx, jsontime.Ptr(start), jsontime.New(h.d.Clock()), userID, existing.ID)
			if err == nil {
				var ep q.Episode
				ep, err = qtx.InsertEpisode(ctx, placeholder(userID, start, onset, nil, true, "migraine", wpiID, weather))
				createdID = ep.ID
			}
			if err == nil {
				err = tx.Commit(ctx)
			}
			if err != nil {
				_ = tx.Rollback(ctx)
				httpx.Unhandled(w)
				return
			}
			h.d.Log.Info("Episode upgraded (quick-add: headache -> migraine)", "userId", userID, "upgradedFromEpisodeId", existing.ID, "episodeId", createdID)
			zone, zerr := usertz.Get(ctx, h.d.Q, userID)
			if zerr == nil {
				end := start
				dates := diary.TouchedDates(existing.StartTime.Time, &end, false, h.d.Clock(), zone)
				dates = append(dates, diary.TouchedDates(start, nil, true, h.d.Clock(), zone)...)
				recompute(dates, "quick-add upgrade")
			} else {
				h.d.Log.Warn("Failed to recompute diary day rows after quick-add upgrade", "userId", userID, "error", zerr)
			}
			httpx.JSON(w, http.StatusCreated, httpx.O("episodeId", createdID, "upgradedFromEpisodeId", existing.ID))
			return
		}
		if existing != nil {
			httpx.JSON(w, http.StatusConflict, httpx.O("error", "An attack is already in progress.", "code", "ONGOING_EXISTS",
				"ongoing", httpx.O("episodeId", existing.ID, "attackType", existing.AttackType)))
			return
		}

		wpiID, weather := h.svc.WeatherContext(ctx, userID, start)
		ep, err := h.d.Q.InsertEpisode(ctx, placeholder(userID, start, onset, nil, true, attackType, wpiID, weather))
		if err != nil {
			httpx.Unhandled(w)
			return
		}
		h.d.Log.Info("Episode created (quick-add)", "userId", userID, "episodeId", ep.ID)
		zone, zerr := usertz.Get(ctx, h.d.Q, userID)
		if zerr == nil {
			recompute(diary.TouchedDates(start, nil, true, h.d.Clock(), zone), "quick-add")
		} else {
			h.d.Log.Warn("Failed to recompute diary day rows after quick-add", "userId", userID, "error", zerr)
		}
		httpx.JSON(w, http.StatusCreated, httpx.O("episodeId", ep.ID))
	})
}

// historical creates a finished one-hour attack at noon of a past local date.
func (h handlers) historical(w http.ResponseWriter, r *http.Request, userID, ymd, attackType string, onset *time.Time) {
	ctx := r.Context()
	fail := func(err error) {
		h.d.Log.Error("Failed to create historical episode", "userId", userID, "error", err)
		httpx.Internal(w)
	}
	zone, err := usertz.Get(ctx, h.d.Q, userID)
	if err != nil {
		fail(err)
		return
	}
	day, ok := localdate.ParseInZone(ymd, tz.LoadOrUTC(zone))
	if !ok {
		fail(err)
		return
	}
	start := day.Add(12 * time.Hour).UTC()
	end := day.Add(13 * time.Hour).UTC()
	wpiID, weather := h.svc.WeatherContext(ctx, userID, start)
	ep, err := h.d.Q.InsertEpisode(ctx, placeholder(userID, start, onset, &end, false, attackType, wpiID, weather))
	if err != nil {
		fail(err)
		return
	}
	h.d.Log.Info("Episode created (quick-add historical)", "userId", userID, "episodeId", ep.ID, "localDate", ymd)
	if _, err := diary.Recompute(ctx, h.d.Q, userID, diary.TouchedDates(start, &end, false, h.d.Clock(), zone), zone, h.d.Clock()); err != nil {
		h.d.Log.Warn("Failed to recompute diary day rows after quick-add historical", "userId", userID, "error", err)
	}
	httpx.JSON(w, http.StatusCreated, httpx.O("episodeId", ep.ID))
}
