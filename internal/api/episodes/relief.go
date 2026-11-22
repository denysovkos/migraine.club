package episodes

import (
	"math"
	"net/http"
	"strconv"

	"github.com/denysovkos/migraine.club/internal/api/idem"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
)

// GET /api/relief-sessions[?episodeId=N]
func (h handlers) listRelief(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	var episodeID *int32
	if raw, ok := r.URL.Query()["episodeId"]; ok {
		v := raw[0]
		n, err := strconv.ParseFloat(v, 64)
		if !digitsRe.MatchString(v) || err != nil || n > 9007199254740991 || n <= 0 {
			httpx.Error(w, http.StatusBadRequest, "Invalid episode ID")
			return
		}
		if n > math.MaxInt32 {
			// Safe integer, but no serial id can be that large: no rows.
			httpx.JSON(w, http.StatusOK, httpx.O("sessions", []any{}))
			return
		}
		id := int32(n)
		episodeID = &id
	}
	sessions, err := h.svc.ListReliefSessions(r.Context(), userID, episodeID)
	if err != nil {
		h.painError(w, err, "listing relief session")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("sessions", sessions))
}

// POST /api/relief-sessions
func (h handlers) addRelief(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	idem.Wrap(h.d.Q, h.d.Log, h.d.Clock, w, r, userID, "relief-sessions", func(w http.ResponseWriter, r *http.Request) {
		body, err := httpx.ReadJSON(r)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "Invalid JSON body")
			return
		}
		session, err := h.svc.AddReliefSession(r.Context(), userID, body)
		if err != nil {
			h.painError(w, err, "creating relief session")
			return
		}
		httpx.JSON(w, http.StatusCreated, httpx.O("session", session))
	})
}
