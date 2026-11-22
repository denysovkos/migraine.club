// Package consent answers whether a user may have health data processed.
package consent

import (
	"context"

	"github.com/denysovkos/migraine.club/internal/db/q"
)

// HasHealthDataConsent reports whether the user has active health_data,
// terms and privacy consents (src/app/api/_helpers/healthDataConsent.ts).
func HasHealthDataConsent(ctx context.Context, qs *q.Queries, userID string) (bool, error) {
	types, err := qs.ActiveConsentTypes(ctx, userID)
	if err != nil {
		return false, err
	}
	have := map[string]bool{}
	for _, t := range types {
		have[t] = true
	}
	return have["health_data"] && have["terms"] && have["privacy"], nil
}
