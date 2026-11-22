// Package user serves /api/user/*.
package user

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var consentTypes = []string{"health_data", "terms", "privacy", "analytics"}

var createConsentSchema = zod.Object(
	zod.F("consentType", zod.Enum(consentTypes...)),
	zod.F("version", zod.Default(zod.String(), "1.0")),
)

type consentHandlers struct{ d *app.Deps }

// GET /api/user/consent
func (h consentHandlers) list(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	rows, err := h.d.Q.ActiveConsents(r.Context(), userID)
	if err != nil {
		h.d.Log.Error("Error fetching user consents", "error", err)
		httpx.Internal(w)
		return
	}
	m := httpx.NewObject()
	for _, c := range rows {
		m.Set(c.ConsentType, httpx.O("version", c.Version, "givenAt", c.GivenAt))
	}
	httpx.JSON(w, http.StatusOK, httpx.O("consents", m))
}

// clientIP mirrors `forwardedFor?.split(',')[0] ?? x-real-ip ?? 'unknown'`.
func clientIP(r *http.Request) string {
	if vals, ok := r.Header[http.CanonicalHeaderKey("x-forwarded-for")]; ok {
		return strings.Split(strings.Join(vals, ", "), ",")[0]
	}
	if v := r.Header.Get("x-real-ip"); v != "" || r.Header[http.CanonicalHeaderKey("x-real-ip")] != nil {
		return v
	}
	return "unknown"
}

func userAgent(r *http.Request) string {
	if _, ok := r.Header["User-Agent"]; ok {
		return r.Header.Get("User-Agent")
	}
	return "unknown"
}

// POST /api/user/consent
func (h consentHandlers) create(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		h.d.Log.Error("Error creating user consent", "error", err)
		httpx.Internal(w)
		return
	}
	var in struct {
		ConsentType string `json:"consentType"`
		Version     string `json:"version"`
	}
	if err := zod.ParseInto(createConsentSchema, body, &in); err != nil {
		var zerr *zod.Error
		if errors.As(err, &zerr) {
			httpx.ValidationError(w, zerr)
			return
		}
		httpx.Internal(w)
		return
	}

	ip := clientIP(r)
	ua := userAgent(r)
	now := jsontime.New(h.d.Clock())
	ctx := r.Context()

	existing, err := h.d.Q.ActiveConsentByType(ctx, userID, in.ConsentType)
	switch {
	case err == nil:
		updated, err := h.d.Q.RenewConsent(ctx, q.RenewConsentParams{
			Version: in.Version, Now: now, IpAddress: &ip, UserAgent: &ua, ID: existing.ID,
		})
		if err != nil {
			h.d.Log.Error("Error creating user consent", "error", err)
			httpx.Internal(w)
			return
		}
		h.d.Log.Info("User consent updated", "userId", userID, "consentType", in.ConsentType, "action", "updated")
		httpx.JSON(w, http.StatusOK, updated)
		return
	case !errors.Is(err, pgx.ErrNoRows):
		h.d.Log.Error("Error creating user consent", "error", err)
		httpx.Internal(w)
		return
	}

	created, err := h.d.Q.InsertConsent(ctx, q.InsertConsentParams{
		UserID: userID, ConsentType: in.ConsentType, Version: in.Version,
		GivenAt: now, IpAddress: &ip, UserAgent: &ua,
	})
	if err != nil {
		h.d.Log.Error("Error creating user consent", "error", err)
		httpx.Internal(w)
		return
	}
	h.d.Log.Info("User consent created", "userId", userID, "consentType", in.ConsentType, "action", "created")
	httpx.JSON(w, http.StatusCreated, created)
}

// DELETE /api/user/consent?type=...
func (h consentHandlers) withdraw(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	t := r.URL.Query().Get("type")
	valid := false
	for _, c := range consentTypes {
		if t == c {
			valid = true
		}
	}
	if !valid {
		httpx.Error(w, http.StatusBadRequest, "Invalid consent type")
		return
	}
	rows, err := h.d.Q.WithdrawConsent(r.Context(), jsontime.Ptr(h.d.Clock()), userID, t)
	if err != nil {
		h.d.Log.Error("Error withdrawing user consent", "error", err)
		httpx.Internal(w)
		return
	}
	if len(rows) == 0 {
		httpx.Error(w, http.StatusNotFound, "No active consent found")
		return
	}
	h.d.Log.Info("User consent withdrawn", "userId", userID, "consentType", t, "action", "withdrawn")
	httpx.JSON(w, http.StatusOK, httpx.O("success", true))
}
