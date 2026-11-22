// Package episodes serves /api/episodes/*.
package episodes

import (
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/denysovkos/migraine.club/internal/api/idem"
	"github.com/denysovkos/migraine.club/internal/api/weather"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/service/diary"
	"github.com/denysovkos/migraine.club/internal/service/episodes"
	"github.com/denysovkos/migraine.club/internal/service/usertz"
	"github.com/denysovkos/migraine.club/internal/zod"
)

type handlers struct {
	d   *app.Deps
	svc *episodes.Service
}

// NewService builds the episode service from deps.
func NewService(d *app.Deps) *episodes.Service {
	return &episodes.Service{Pool: d.Pool, Q: d.Q, Log: d.Log, WPI: weather.NewWPI(d), Now: d.Clock}
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: NewService(d)}
	r.Get("/api/episodes", h.list)
	r.Post("/api/episodes", h.create)
	r.Get("/api/episodes/recent", h.recent)
	r.Get("/api/episodes/{id}", h.get)
	r.Patch("/api/episodes/{id}", h.patch)
	r.Delete("/api/episodes/{id}", h.delete)
	r.Post("/api/quick-add/episode", h.quickEpisode)
	r.Get("/api/relief-sessions", h.listRelief)
	r.Post("/api/relief-sessions", h.addRelief)
	mountPainReadings(r, d)
}

func errorResponse(w http.ResponseWriter, err *episodes.Error) {
	switch err.Code {
	case "CONSENT_REQUIRED":
		httpx.JSON(w, http.StatusForbidden, httpx.O("error", "Health data consent required", "code", "CONSENT_REQUIRED", "message", err.Message))
	case "ONGOING_EXISTS":
		o := httpx.O("error", err.Message, "code", "ONGOING_EXISTS")
		if err.Details != nil {
			for _, k := range err.Details.Keys() {
				v, _ := err.Details.Get(k)
				o.Set(k, v)
			}
		}
		httpx.JSON(w, http.StatusConflict, o)
	default:
		httpx.JSON(w, http.StatusBadRequest, httpx.O("error", err.Message, "code", err.Code))
	}
}

// POST /api/episodes
func (h handlers) create(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	idem.Wrap(h.d.Q, h.d.Log, h.d.Clock, w, r, userID, "episodes", func(w http.ResponseWriter, r *http.Request) {
		body, err := httpx.ReadJSON(r)
		if err == nil {
			var ep qEpisode
			ep, err = h.svc.Create(r.Context(), userID, body)
			if err == nil {
				httpx.JSON(w, http.StatusCreated, episodes.DTO(ep))
				return
			}
		}
		var eerr *episodes.Error
		var zerr *zod.Error
		switch {
		case errors.As(err, &eerr):
			errorResponse(w, eerr)
		case errors.As(err, &zerr):
			h.d.Log.Warn("Validation error creating episode")
			httpx.ValidationError(w, zerr)
		default:
			h.d.Log.Error("Error creating episode", "error", err)
			httpx.Internal(w)
		}
	})
}

// parseDate is `new Date(s)` for query bounds; ok=false is an Invalid Date,
// which made Drizzle throw (500).
func parseDate(s string) (time.Time, bool) {
	t, err := jsontime.Parse(s)
	return t, err == nil
}

// GET /api/episodes
func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	qp := r.URL.Query()
	page, _ := jsx.ParseInt(orDefault(qp, "page", "1"))
	limit, _ := jsx.ParseInt(orDefault(qp, "limit", "20"))
	var from, to *time.Time
	for _, b := range []struct {
		key string
		dst **time.Time
	}{{"from", &from}, {"to", &to}} {
		if v := qp.Get(b.key); v != "" {
			t, ok := parseDate(v)
			if !ok {
				h.d.Log.Error("Error fetching episodes", "error", "invalid date "+b.key)
				httpx.Internal(w)
				return
			}
			*b.dst = &t
		}
	}
	res, err := h.svc.List(r.Context(), userID, page, limit, from, to)
	if err != nil {
		h.d.Log.Error("Error fetching episodes", "error", err)
		httpx.Internal(w)
		return
	}
	list := make([]any, len(res.Episodes))
	for i, ep := range res.Episodes {
		list[i] = episodes.DTO(ep)
	}
	httpx.JSON(w, http.StatusOK, httpx.O("episodes", list,
		"pagination", httpx.O("page", res.Page, "limit", res.Limit, "total", res.Total, "totalPages", res.TotalPages())))
}

func orDefault(qp map[string][]string, k, def string) string {
	if v, ok := qp[k]; ok && len(v) > 0 {
		return v[0]
	}
	return def
}

var schemaMismatchMsg = "Database schema is out of date. Please run migrations (npm run db:migrate)."

func isUndefinedColumn(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "42703"
}

// GET /api/episodes/recent
func (h handlers) recent(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	limit := 3
	if v := r.URL.Query().Get("limit"); v != "" {
		n, ok := jsx.ParseInt(v)
		if !ok || n < 1 || n > 50 {
			httpx.Error(w, http.StatusBadRequest, "Invalid limit parameter. Must be between 1 and 50.")
			return
		}
		limit = n
	}
	rows, err := h.d.Q.RecentEpisodes(r.Context(), userID, int32(limit))
	if err != nil {
		if isUndefinedColumn(err) {
			h.d.Log.Error("Error fetching recent episodes (DB schema mismatch: missing column). Run migrations (npm run db:migrate).", "error", err)
			httpx.Error(w, http.StatusInternalServerError, schemaMismatchMsg)
			return
		}
		h.d.Log.Error("Error fetching recent episodes", "error", err)
		httpx.Internal(w)
		return
	}
	out := make([]any, len(rows))
	for i, ep := range rows {
		out[i] = httpx.O(
			"id", ep.ID, "userId", ep.UserID, "attackType", ep.AttackType, "startTime", ep.StartTime,
			"endTime", ep.EndTime, "isOngoing", ep.IsOngoing, "intensity", ep.Intensity,
			"painLocation", ep.PainLocation, "painLocationOther", ep.PainLocationOther,
			"painType", ep.PainType, "painTypeOther", ep.PainTypeOther,
			"symptoms", ep.Symptoms, "symptomsOther", ep.SymptomsOther, "medicationIntakes", []any{},
			"triggers", ep.Triggers, "protectors", ep.Protectors, "triggersOther", ep.TriggersOther,
			"notes", ep.Notes, "weatherPainIndexId", ep.WeatherPainIndexID,
			"weatherContext", rawOrNull(ep.WeatherContext), "createdAt", ep.CreatedAt, "updatedAt", ep.UpdatedAt)
	}
	httpx.JSON(w, http.StatusOK, httpx.O("episodes", out))
}

func rawOrNull(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return jsonRaw(b)
}


// medicationIntakes is loadMedicationIntakes.
func (h handlers) medicationIntakes(r *http.Request, userID string, id int32) ([]any, error) {
	rows, err := h.d.Q.EpisodeMedicationIntakes(r.Context(), userID, &id)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, mi := range rows {
		label := ""
		if mi.MedicationName != nil {
			label = *mi.MedicationName
		} else {
			raw := "Medication"
			if mi.CustomName != nil {
				raw = *mi.CustomName
			} else if mi.CanonicalName != nil {
				raw = *mi.CanonicalName
			}
			label = jsx.CollapseSpace(jsx.Trim(raw), " ")
		}
		out[i] = httpx.O("id", mi.ID, "takenAt", jsontime.Format(mi.TakenAt.Time), "label", label,
			"dose", mi.Dose, "unit", mi.Unit, "unitIsCustom", mi.UnitIsCustom)
	}
	return out, nil
}

// errIDOutOfRange is what Postgres answered for a parsed id outside the
// integer column's range: the route's first query failed.
var errIDOutOfRange = errors.New("value out of range for type integer")

// episodeID is Number.parseInt(id, 10) with the NaN check. An id beyond int4
// passed the check in Node and failed at the first query, so the handler
// reports rangeErr where that query ran.
func episodeID(w http.ResponseWriter, r *http.Request) (id int32, rangeErr error, ok bool) {
	n, ok := jsx.ParseInt(chi.URLParam(r, "id"))
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "Invalid episode ID")
		return 0, nil, false
	}
	if n < math.MinInt32 || n > math.MaxInt32 {
		return 0, errIDOutOfRange, true
	}
	return int32(n), nil, true
}

func (h handlers) detail(r *http.Request, userID string, ep qEpisode) (any, error) {
	intakes, err := h.medicationIntakes(r, userID, ep.ID)
	if err != nil {
		return nil, err
	}
	treatment, err := episodes.TreatmentModel(r.Context(), h.d.Q, ep.ID, h.d.Clock())
	if err != nil {
		return nil, err
	}
	return episodes.Detail(ep, intakes, treatment), nil
}

// GET /api/episodes/{id}
func (h handlers) get(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	id, rangeErr, ok := episodeID(w, r)
	if !ok {
		return
	}
	fail := func(err error) {
		if isUndefinedColumn(err) {
			h.d.Log.Error("Error fetching episode (DB schema mismatch: missing column). Run migrations (npm run db:migrate).", "error", err)
			httpx.Error(w, http.StatusInternalServerError, schemaMismatchMsg)
			return
		}
		h.d.Log.Error("Error fetching episode", "error", err)
		httpx.Internal(w)
	}
	if rangeErr != nil {
		fail(rangeErr)
		return
	}
	ep, err := h.svc.Get(r.Context(), userID, id)
	if err != nil {
		fail(err)
		return
	}
	if ep == nil {
		httpx.Error(w, http.StatusNotFound, "Episode not found")
		return
	}
	body, err := h.detail(r, userID, *ep)
	if err != nil {
		fail(err)
		return
	}
	httpx.JSON(w, http.StatusOK, body)
}

// PATCH /api/episodes/{id}
func (h handlers) patch(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	idem.Wrap(h.d.Q, h.d.Log, h.d.Clock, w, r, userID, "episodes/:id", func(w http.ResponseWriter, r *http.Request) {
		id, rangeErr, ok := episodeID(w, r)
		if !ok {
			return
		}
		fail := func(err error) {
			var eerr *episodes.Error
			var zerr *zod.Error
			switch {
			case errors.As(err, &eerr):
				status := http.StatusBadRequest
				switch eerr.Code {
				case "NOT_FOUND":
					status = http.StatusNotFound
				case "NOT_EDITABLE":
					status = http.StatusForbidden
				}
				httpx.Error(w, status, eerr.Message)
			case errors.As(err, &zerr):
				h.d.Log.Warn("Validation error updating episode")
				httpx.ValidationError(w, zerr)
			default:
				h.d.Log.Error("Error updating episode", "error", err)
				httpx.Internal(w)
			}
		}
		body, err := httpx.ReadJSON(r)
		if err != nil {
			// request.json() runs after the episode lookup in the service
			// call; an unknown episode with a bad body is still a 500.
			fail(err)
			return
		}
		if rangeErr != nil {
			fail(rangeErr)
			return
		}
		updated, err := h.svc.Update(r.Context(), userID, id, body)
		if err != nil {
			fail(err)
			return
		}
		out, err := h.detail(r, userID, updated)
		if err != nil {
			fail(err)
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	})
}

// DELETE /api/episodes/{id}
func (h handlers) delete(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	id, rangeErr, ok := episodeID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	fail := func(err error) {
		h.d.Log.Error("Error deleting episode", "error", err)
		httpx.Internal(w)
	}
	if rangeErr != nil {
		fail(rangeErr)
		return
	}
	existing, err := h.svc.Get(ctx, userID, id)
	if err != nil {
		fail(err)
		return
	}
	if existing == nil {
		httpx.Error(w, http.StatusNotFound, "Episode not found")
		return
	}
	zone, zerr := usertz.Get(ctx, h.d.Q, userID)
	var touched []string
	if zerr == nil {
		touched = episodes.TouchedDates(*existing, zone, h.d.Clock())
	}
	if err := h.d.Q.DeleteEpisode(ctx, id, userID); err != nil {
		fail(err)
		return
	}
	h.d.Log.Info("Episode deleted", "episodeId", id, "userId", userID)
	if zerr == nil && len(touched) > 0 {
		if _, err := diary.Recompute(ctx, h.d.Q, userID, touched, zone, h.d.Clock()); err != nil {
			h.d.Log.Warn("Failed to recompute diary day rows after episode delete", "userId", userID, "episodeId", id, "error", err)
		}
	}
	httpx.JSON(w, http.StatusOK, httpx.O("success", true))
}
