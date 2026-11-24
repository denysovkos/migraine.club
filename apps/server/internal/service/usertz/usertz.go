// Package usertz is the single source of truth for a user's time zone.
package usertz

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
)

// Get is getUserTimezone: user_outcome_settings.timezone when set, then
// user_weather_settings.timezone, then UTC.
func Get(ctx context.Context, qs *q.Queries, userID string) (string, error) {
	tz1, err := qs.OutcomeSettingsTimezone(ctx, userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if tz1 != nil && *tz1 != "" {
		return *tz1, nil
	}
	tz2, err := qs.WeatherSettingsTimezone(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "UTC", nil
	}
	if err != nil {
		return "", err
	}
	return tz2, nil
}
