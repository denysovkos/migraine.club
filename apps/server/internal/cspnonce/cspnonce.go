// Package cspnonce carries the per-request Content-Security-Policy nonce
// from the middleware that sends the policy to the handler that renders
// the page, which stamps it on the page's scripts.
package cspnonce

import (
	"context"
	"crypto/rand"
	"encoding/base64"
)

type key struct{}

// New returns a fresh nonce: 16 random bytes, base64.
func New() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

// With returns ctx carrying nonce.
func With(ctx context.Context, nonce string) context.Context {
	return context.WithValue(ctx, key{}, nonce)
}

// From returns the request's nonce, or "" when there is none.
func From(ctx context.Context) string {
	n, _ := ctx.Value(key{}).(string)
	return n
}
