// Package profile is UserProfileService: the app's own user record.
package profile

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// SupportedLanguages and ThemePreferences are the values Schema.ts allows.
var (
	SupportedLanguages = []string{"en", "fr", "uk"}
	ThemePreferences   = []string{"light", "dark"}
)

const defaultLocale = "en"
const maxRetries = 3

// Profile is UserProfile.
type Profile struct {
	ID                string
	DisplayName       string
	PreferredLanguage string
	ThemePreference   string
	IsDoctor          bool
	IsDoctorVerified  bool
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func fromRow(u q.User) Profile {
	return Profile{
		ID: u.ID, DisplayName: u.DisplayName, PreferredLanguage: u.PreferredLanguage,
		ThemePreference: u.ThemePreference, IsDoctor: u.IsDoctor, IsDoctorVerified: u.IsDoctorVerified,
		CreatedAt: u.CreatedAt.Time, UpdatedAt: u.UpdatedAt.Time,
	}
}

// Hints are what the auth provider knows about a new user.
type Hints struct {
	FirstName, LastName, Username *string
	ClerkLocale                   *string
	AcceptLanguage                *string
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// DetectPreferredLanguage is detectPreferredLanguage.
func DetectPreferredLanguage(clerkLocale, acceptLanguage string) string {
	if clerkLocale != "" {
		base := strings.ToLower(strings.Split(clerkLocale, "-")[0])
		if base != "" && slices.Contains(SupportedLanguages, base) {
			return base
		}
	}
	if acceptLanguage != "" {
		for _, part := range strings.Split(acceptLanguage, ",") {
			code := strings.Split(jsx.Trim(part), ";")[0]
			lang := strings.ToLower(strings.Split(code, "-")[0])
			if lang != "" && slices.Contains(SupportedLanguages, lang) {
				return lang
			}
		}
	}
	return defaultLocale
}

// DeriveDisplayName is deriveDisplayNameFromClerk.
func DeriveDisplayName(userID, first, last, username string) string {
	if first != "" || last != "" {
		var parts []string
		for _, p := range []string{first, last} {
			if p != "" {
				parts = append(parts, p)
			}
		}
		full := jsx.Trim(strings.Join(parts, " "))
		if jsx.Len(full) >= 2 {
			return SanitizeDisplayName(full)
		}
	}
	if username != "" && jsx.Len(username) >= 2 {
		return SanitizeDisplayName(username)
	}
	return DisplayNameFromSeed(userID)
}

// Service reads and writes profiles.
type Service struct {
	Q   *q.Queries
	Log *slog.Logger
	Now func() time.Time
	// Sleep is replaced in tests.
	Sleep func(time.Duration)
}

func (s *Service) now() jsontime.Time { return jsontime.New(s.Now()) }

// GetOrCreate is getOrCreateProfile.
func (s *Service) GetOrCreate(ctx context.Context, userID string, h Hints) (Profile, error) {
	existing, err := s.Q.GetUser(ctx, userID)
	if err == nil {
		if existing.DisplayName == "" {
			name := DeriveDisplayName(userID, deref(h.FirstName), deref(h.LastName), deref(h.Username))
			updated, err := s.Q.SetUserDisplayName(ctx, name, s.now(), userID)
			if err == nil {
				s.Log.Info("Updated existing user with display name", "userId", userID)
				return fromRow(updated), nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return Profile{}, err
			}
		}
		return fromRow(existing), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, err
	}

	name := DeriveDisplayName(userID, deref(h.FirstName), deref(h.LastName), deref(h.Username))
	lang := DetectPreferredLanguage(deref(h.ClerkLocale), deref(h.AcceptLanguage))

	for attempt := 0; attempt < maxRetries; attempt++ {
		p, done, err := s.tryCreate(ctx, userID, name, lang)
		if err == nil && done {
			return p, nil
		}
		if err != nil {
			s.Log.Error("Error creating profile, retrying", "userId", userID, "attempt", attempt, "error", err)
			if attempt == maxRetries-1 {
				return Profile{}, err
			}
		}
		s.sleep(time.Duration(100*(attempt+1)) * time.Millisecond)
	}

	final, err := s.Q.GetUser(ctx, userID)
	if err == nil {
		return fromRow(final), nil
	}
	return Profile{}, fmt.Errorf("Failed to create user profile after %d attempts", maxRetries)
}

func (s *Service) sleep(d time.Duration) {
	if s.Sleep != nil {
		s.Sleep(d)
		return
	}
	time.Sleep(d)
}

func (s *Service) tryCreate(ctx context.Context, userID, name, lang string) (Profile, bool, error) {
	created, err := s.Q.InsertUserIfMissing(ctx, userID, name, lang)
	if err != nil {
		return Profile{}, false, err
	}
	if len(created) > 0 {
		s.Log.Info("Created new user profile", "userId", userID, "displayName", name, "preferredLanguage", lang)
		return fromRow(created[0]), true, nil
	}
	after, err := s.Q.GetUser(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, false, nil
	}
	if err != nil {
		return Profile{}, false, err
	}
	s.Log.Info("Profile already existed (race condition)", "userId", userID)
	if after.DisplayName == "" {
		updated, err := s.Q.SetUserDisplayName(ctx, name, s.now(), userID)
		if err == nil {
			return fromRow(updated), true, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return Profile{}, false, err
		}
	}
	return fromRow(after), true, nil
}

// Get is getProfile. ok is false when there is no record.
func (s *Service) Get(ctx context.Context, userID string) (Profile, bool, error) {
	u, err := s.Q.GetUser(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, false, nil
	}
	if err != nil {
		return Profile{}, false, err
	}
	return fromRow(u), true, nil
}

// Update is the input of updateProfile. Nil fields are left alone.
type Update struct {
	DisplayName       *string
	PreferredLanguage *string
	ThemePreference   *string
}

// Update is updateProfile. ok is false when the user has no record.
func (s *Service) Update(ctx context.Context, userID string, in Update) (Profile, bool, error) {
	var args q.UpdateUserProfileParams
	changed := false
	if in.DisplayName != nil {
		v := SanitizeDisplayName(*in.DisplayName)
		args.DisplayName = &v
		changed = true
	}
	if in.PreferredLanguage != nil && slices.Contains(SupportedLanguages, *in.PreferredLanguage) {
		args.PreferredLanguage = in.PreferredLanguage
		changed = true
	}
	if in.ThemePreference != nil && slices.Contains(ThemePreferences, *in.ThemePreference) {
		args.ThemePreference = in.ThemePreference
		changed = true
	}
	if !changed {
		return s.Get(ctx, userID)
	}
	args.Now = s.now()
	args.ID = userID
	rows, err := s.Q.UpdateUserProfile(ctx, args)
	if err != nil {
		return Profile{}, false, err
	}
	if len(rows) == 0 {
		return Profile{}, false, nil
	}
	s.Log.Info("Updated user profile", "userId", userID)
	return fromRow(rows[0]), true, nil
}
