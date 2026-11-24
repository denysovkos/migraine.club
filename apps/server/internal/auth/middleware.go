package auth

import (
	"context"
	"net/http"
)

type ctxKey struct{}

type signedOutKey struct{}

// Resolver finds the signed-in user of a request.
type Resolver interface {
	SessionUserID(r *http.Request) string
}

// DocumentResolver tells, for a page request, whether the visitor is
// certainly signed out (see Clerk.DocumentSignedOut).
type DocumentResolver interface {
	DocumentSignedOut(r *http.Request) bool
}

// Mock signs every request in as the e2e user (E2E_MOCK_USER_ID). The Next
// proxy overwrote any client-sent x-e2e-mock-user header with that same id,
// so a request cannot pick another user.
type Mock struct{ UserID string }

// SessionUserID implements Resolver.
func (m Mock) SessionUserID(*http.Request) string { return m.UserID }

// DocumentSignedOut implements DocumentResolver.
func (m Mock) DocumentSignedOut(*http.Request) bool { return m.UserID == "" }

// Middleware resolves the user once per request.
func Middleware(res Resolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid := res.SessionUserID(r)
			ctx := context.WithValue(r.Context(), ctxKey{}, uid)
			if d, ok := res.(DocumentResolver); ok && uid == "" && d.DocumentSignedOut(r) {
				ctx = context.WithValue(ctx, signedOutKey{}, true)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserID returns the signed-in user id, or "" when signed out.
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(ctxKey{}).(string)
	return v
}

// SignedOut reports a page request whose visitor is certainly signed out.
func SignedOut(ctx context.Context) bool {
	v, _ := ctx.Value(signedOutKey{}).(bool)
	return v
}

// WithSignedOut marks a context as certainly signed out (for tests).
func WithSignedOut(ctx context.Context) context.Context {
	return context.WithValue(ctx, signedOutKey{}, true)
}

// WithUserID returns a context signed in as uid (for tests and jobs).
func WithUserID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, ctxKey{}, uid)
}
