// Package mcp is the /api/mcp endpoint: the MCP server of src/server/mcp as
// mcp-handler 2.4 served it on @modelcontextprotocol/server 2.x, both the
// 2025-era stateless streamable HTTP transport and the 2026-07-28
// per-request transport.
package mcp

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/db/q"
)

// NewServer builds the server with its tools.
func NewServer(svc Services, qs *q.Queries, log *slog.Logger, now func() time.Time) (*Server, error) {
	c, err := loadCatalog()
	if err != nil {
		return nil, err
	}
	return &Server{catalog: c, tools: buildTools(svc, now), q: qs, log: log, now: now}, nil
}

// NewHandler wraps the server in the HTTP transport and the token check.
func NewHandler(srv *Server, verify Verifier, log *slog.Logger) *Handler {
	return &Handler{srv: srv, verify: verify, log: log, keepAlive: keepAliveInterval}
}

// E2EVerifier is src/server/mcp/e2eToken.ts: tokens
// `e2e-mcp|<userId>|<scope,scope>|<clientId>`, and `e2e-mcp-throw` fails.
func E2EVerifier(_ context.Context, _ *http.Request, token string, present bool) (*AuthInfo, error) {
	if present && token == "e2e-mcp-throw" {
		return nil, errors.New("verifier failed")
	}
	if !present || !strings.HasPrefix(token, "e2e-mcp|") {
		return nil, nil
	}
	parts := strings.Split(token, "|")
	info := &AuthInfo{Token: token, ClientID: "e2e-client", Scopes: []string{}}
	if len(parts) > 1 {
		info.UserID = parts[1]
	}
	if len(parts) > 2 && parts[2] != "" {
		info.Scopes = strings.Split(parts[2], ",")
	}
	if len(parts) > 3 {
		info.ClientID = parts[3]
	}
	return info, nil
}

// ClerkVerifier is verifyClerkToken over auth({ acceptsToken: 'oauth_token' }):
// a token Clerk does not accept grants nothing.
func ClerkVerifier(c *auth.Clerk) Verifier {
	return func(ctx context.Context, _ *http.Request, token string, present bool) (*AuthInfo, error) {
		if !present || token == "" {
			return nil, nil
		}
		info, err := c.VerifyOAuthToken(ctx, token)
		if errors.Is(err, auth.ErrOAuthInvalid) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &AuthInfo{Token: info.Token, ClientID: info.ClientID, Scopes: info.Scopes, UserID: info.UserID}, nil
	}
}
