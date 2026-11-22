package episodes

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/api/idem"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/episodes"
	"github.com/denysovkos/migraine.club/internal/zod"
)

func mountPainReadings(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: NewService(d)}
	r.Get("/api/episodes/{id}/pain-readings", h.listReadings)
	r.Post("/api/episodes/{id}/pain-readings", h.addReading)
	r.Delete("/api/episodes/{id}/pain-readings/{readingId}", h.deleteReading)
}

var digitsRe = regexp.MustCompile(`^\d+$`)

// parsePainEpisodeID is parseEpisodeId: digits only, a positive safe integer.
func parsePainEpisodeID(s string) (int32, bool) {
	if !digitsRe.MatchString(s) {
		return 0, false
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n <= 0 || n > 2147483647 {
		return 0, false
	}
	return int32(n), true
}

func (h handlers) painError(w http.ResponseWriter, err error, action string) {
	var eerr *episodes.Error
	var zerr *zod.Error
	switch {
	case errors.As(err, &eerr):
		status := http.StatusBadRequest
		switch eerr.Code {
		case "NOT_FOUND":
			status = http.StatusNotFound
		case "CONSENT_REQUIRED":
			status = http.StatusForbidden
		}
		o := httpx.O("error", eerr.Message, "code", eerr.Code)
		if eerr.Details != nil {
			o.Set("details", eerr.Details)
		}
		httpx.JSON(w, status, o)
	case errors.As(err, &zerr):
		httpx.ValidationError(w, zerr)
	default:
		if !strings.HasSuffix(action, "relief session") {
			action += " pain reading"
		}
		h.d.Log.Error("Error "+action, "error", err)
		httpx.Internal(w)
	}
}

// GET /api/episodes/{id}/pain-readings
func (h handlers) listReadings(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	id, ok := parsePainEpisodeID(chi.URLParam(r, "id"))
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "Invalid episode ID")
		return
	}
	readings, err := h.svc.ListPainReadings(r.Context(), userID, id)
	if err != nil {
		h.painError(w, err, "listing")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("readings", readings))
}

// POST /api/episodes/{id}/pain-readings
func (h handlers) addReading(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	idem.Wrap(h.d.Q, h.d.Log, h.d.Clock, w, r, userID, "episodes/:id/pain-readings", func(w http.ResponseWriter, r *http.Request) {
		id, ok := parsePainEpisodeID(chi.URLParam(r, "id"))
		if !ok {
			httpx.Error(w, http.StatusBadRequest, "Invalid episode ID")
			return
		}
		body, err := httpx.ReadJSON(r)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "Invalid JSON body")
			return
		}
		res, err := h.svc.AddPainReading(r.Context(), userID, id, body)
		if err != nil {
			h.painError(w, err, "creating")
			return
		}
		httpx.JSON(w, http.StatusCreated, res)
	})
}

var uuidCheck = zod.String().UUID()

// DELETE /api/episodes/{id}/pain-readings/{readingId}
func (h handlers) deleteReading(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	id, ok := parsePainEpisodeID(chi.URLParam(r, "id"))
	readingID := chi.URLParam(r, "readingId")
	if _, err := zod.Parse(uuidCheck, readingID); !ok || err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid ID")
		return
	}
	peak, err := h.svc.RemovePainReading(r.Context(), userID, id, readingID)
	if err != nil {
		h.painError(w, err, "deleting")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("success", true, "peakIntensity", peak))
}
