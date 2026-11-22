package auth

import (
	"context"
	"net/http"
)

type ctxKey struct{}

// Resolver finds the signed-in user of a request.
type Resolver interface {
	SessionUserID(r *http.Request) string
}

// Mock signs every request in as the e2e user. The header lets a test pick a
// different synthetic user, as the Next proxy's x-e2e-mock-user did.
type Mock struct{ UserID string }

// MockHeader is the header the Next proxy stamped in mock mode.
const MockHeader = "x-e2e-mock-user"

// SessionUserID implements Resolver.
func (m Mock) SessionUserID(r *http.Request) string {
	if v := r.Header.Get(MockHeader); v != "" {
		return v
	}
	return m.UserID
}

// Middleware resolves the user once per request.
func Middleware(res Resolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid := res.SessionUserID(r)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, uid)))
		})
	}
}

// UserID returns the signed-in user id, or "" when signed out.
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(ctxKey{}).(string)
	return v
}

// WithUserID returns a context signed in as uid (for tests and jobs).
func WithUserID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, ctxKey{}, uid)
}
