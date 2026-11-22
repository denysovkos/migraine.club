// Package share serves /api/share (the owner's doctor share links) and the
// public /api/share/{token} view of the shared data.
package share

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/outcomes"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var createSchema = zod.Object(
	zod.F("label", zod.Optional(zod.String().Max(200))),
	zod.F("recipientName", zod.Optional(zod.String().Max(200))),
	zod.F("patientDisplayName", zod.Optional(zod.String().Max(100))),
	zod.F("expiresInDays", zod.Default(zod.Number().Int().Min(1).Max(90), 7.0)),
	zod.F("dateRangeStart", zod.Optional(zod.String().Datetime())),
	zod.F("dateRangeEnd", zod.Optional(zod.String().Datetime())),
	zod.F("appointmentPrepId", zod.Optional(zod.String().GUID())),
)

type handlers struct {
	d        *app.Deps
	outcomes *outcomes.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, outcomes: &outcomes.Service{Q: d.Q, Now: d.Clock}}
	r.Post("/api/share", h.create)
	r.Get("/api/share", h.list)
	r.Delete("/api/share", h.revoke)
	r.Get("/api/share/{token}", h.view)
}

// generateToken is crypto.randomBytes(32).toString('base64url').
func generateToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func strPtr(m map[string]any, k string) *string {
	if v, ok := m[k].(string); ok {
		return &v
	}
	return nil
}

// jsDate is `new Date(iso)` for a string Zod accepted as a UTC datetime.
func jsDate(m map[string]any, k string) (*jsontime.Time, error) {
	s, ok := m[k].(string)
	if !ok || s == "" {
		return nil, nil
	}
	t, err := jsontime.Parse(s)
	if err != nil {
		return nil, err
	}
	return jsontime.Ptr(t.Truncate(time.Millisecond)), nil
}

func (h handlers) create(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	fail := func(err error) {
		h.d.Log.Error("Error creating share link", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "Failed to create share link")
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(err)
		return
	}
	parsed, err := zod.Parse(createSchema, body)
	if err != nil {
		var zerr *zod.Error
		if errors.As(err, &zerr) {
			httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Invalid request data", "details", zerr.Issues))
			return
		}
		fail(err)
		return
	}
	in := parsed.(map[string]any)

	// expiresAt.setDate(getDate() + days) on the server's local clock.
	now := h.d.Clock().Truncate(time.Millisecond).In(time.Local)
	expires := time.Date(now.Year(), now.Month(), now.Day()+int(in["expiresInDays"].(float64)),
		now.Hour(), now.Minute(), now.Second(), now.Nanosecond(), time.Local)
	start, err1 := jsDate(in, "dateRangeStart")
	end, err2 := jsDate(in, "dateRangeEnd")
	if err := errors.Join(err1, err2); err != nil {
		fail(err)
		return
	}
	link, err := h.d.Q.InsertShareLink(r.Context(), q.InsertShareLinkParams{
		UserID: uid, Token: generateToken(), Label: strPtr(in, "label"), RecipientName: strPtr(in, "recipientName"),
		PatientDisplayName: strPtr(in, "patientDisplayName"), ExpiresAt: jsontime.New(expires),
		DateRangeStart: start, DateRangeEnd: end, AppointmentPrepID: strPtr(in, "appointmentPrepId"),
	})
	if err != nil {
		fail(err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("id", link.ID, "token", link.Token, "expiresAt", jsontime.Format(link.ExpiresAt.Time),
		"label", link.Label, "recipientName", link.RecipientName))
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	rows, err := h.d.Q.ListShareLinks(r.Context(), uid)
	if err != nil {
		h.d.Log.Error("Error fetching share links", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "Failed to fetch share links")
		return
	}
	if rows == nil {
		rows = []q.ListShareLinksRow{}
	}
	httpx.JSON(w, http.StatusOK, rows)
}

// truthy is JavaScript's ToBoolean for a parsed JSON value.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && x == x
	case string:
		return x != ""
	default:
		return true
	}
}

func (h handlers) revoke(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	fail := func(err error) {
		h.d.Log.Error("Error revoking share link", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "Failed to revoke share link")
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(err)
		return
	}
	// `const { id } = await request.json()`: destructuring null throws.
	if body == nil {
		fail(errors.New("Cannot destructure property 'id' of null"))
		return
	}
	var id any
	if m, ok := body.(map[string]any); ok {
		id = m["id"]
	}
	if !truthy(id) {
		httpx.Error(w, http.StatusBadRequest, "Missing link ID")
		return
	}
	// Any id that is not a uuid string failed in Postgres.
	s, ok := id.(string)
	if !ok {
		fail(errors.New("invalid input syntax for type uuid"))
		return
	}
	ids, err := h.d.Q.RevokeShareLink(r.Context(), jsontime.New(h.d.Clock()), s, uid)
	if err != nil {
		fail(err)
		return
	}
	if len(ids) == 0 {
		httpx.Error(w, http.StatusNotFound, "Share link not found")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("success", true))
}
