package user

import (
	"errors"
	"net/http"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/service/profile"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var updateProfileSchema = zod.Object(
	zod.F("displayName", zod.Optional(zod.String().
		Min(2, "Display name must be at least 2 characters").
		Max(50, "Display name must be at most 50 characters"))),
	zod.F("preferredLanguage", zod.Optional(zod.Enum(profile.SupportedLanguages...))),
	zod.F("themePreference", zod.Optional(zod.Enum(profile.ThemePreferences...))),
)

type profileHandlers struct {
	d   *app.Deps
	svc *profile.Service
}

func profileJSON(p profile.Profile) *httpx.Object {
	return httpx.O(
		"id", p.ID,
		"displayName", p.DisplayName,
		"preferredLanguage", p.PreferredLanguage,
		"themePreference", p.ThemePreference,
		"isDoctor", p.IsDoctor,
		"isDoctorVerified", p.IsDoctorVerified,
		"createdAt", jsontime.Format(p.CreatedAt),
		"updatedAt", jsontime.Format(p.UpdatedAt),
	)
}

func optHeader(r *http.Request, name string) *string {
	if _, ok := r.Header[http.CanonicalHeaderKey(name)]; !ok {
		return nil
	}
	v := r.Header.Get(name)
	return &v
}

// GET /api/user/profile
func (h profileHandlers) get(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		h.d.Log.Warn("Profile GET: No userId in auth result")
		httpx.Unauthorized(w)
		return
	}
	h.d.Log.Info("Profile GET: Fetching profile", "userId", userID)
	fail := func(err error) {
		h.d.Log.Error("Profile GET: Error fetching/creating user profile", "userId", userID, "error", err)
		httpx.Error(w, http.StatusInternalServerError, "Failed to fetch profile")
	}

	u, err := h.d.Users.Get(r.Context(), userID)
	if err != nil {
		fail(err)
		return
	}
	hints := profile.Hints{AcceptLanguage: optHeader(r, "accept-language")}
	if u != nil {
		hints.FirstName, hints.LastName, hints.Username = u.FirstName, u.LastName, u.Username
		if loc, ok := u.PublicMetadata["locale"].(string); ok {
			hints.ClerkLocale = &loc
		}
	}
	p, err := h.svc.GetOrCreate(r.Context(), userID, hints)
	if err != nil {
		fail(err)
		return
	}
	h.d.Log.Info("Profile GET: Success", "userId", userID)
	httpx.JSON(w, http.StatusOK, profileJSON(p))
}

// PUT /api/user/profile
func (h profileHandlers) put(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserID(r.Context())
	if userID == "" {
		httpx.Unauthorized(w)
		return
	}
	fail := func(err error) {
		h.d.Log.Error("Error updating user profile", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "Failed to update profile")
	}
	body, err := httpx.ReadJSON(r)
	if err != nil {
		fail(err)
		return
	}
	var in struct {
		DisplayName       *string `json:"displayName"`
		PreferredLanguage *string `json:"preferredLanguage"`
		ThemePreference   *string `json:"themePreference"`
	}
	if err := zod.ParseInto(updateProfileSchema, body, &in); err != nil {
		var zerr *zod.Error
		if errors.As(err, &zerr) {
			httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Validation failed", "details", zerr.Flatten().FieldErrors))
			return
		}
		fail(err)
		return
	}
	if in.DisplayName != nil && !profile.IsValidDisplayName(*in.DisplayName) {
		httpx.Error(w, http.StatusBadRequest, "Invalid display name")
		return
	}
	p, ok, err := h.svc.Update(r.Context(), userID, profile.Update{
		DisplayName: in.DisplayName, PreferredLanguage: in.PreferredLanguage, ThemePreference: in.ThemePreference,
	})
	if err != nil {
		fail(err)
		return
	}
	if !ok {
		httpx.Error(w, http.StatusNotFound, "Profile not found")
		return
	}
	httpx.JSON(w, http.StatusOK, profileJSON(p))
}
