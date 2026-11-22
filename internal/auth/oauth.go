package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// OAuthInfo is what @clerk/mcp-tools verifyClerkToken returned for a valid
// OAuth access token.
type OAuthInfo struct {
	Token    string
	Scopes   []string
	ClientID string
	UserID   string
}

// ErrOAuthInvalid means the token is not a valid Clerk OAuth access token.
var ErrOAuthInvalid = errors.New("invalid OAuth access token")

// VerifyOAuthToken accepts Clerk OAuth access tokens in either form Clerk
// issues: JWTs with header typ at+jwt (verified against the instance JWKS)
// and opaque oat_ tokens (verified by the Backend API).
func (c *Clerk) VerifyOAuthToken(ctx context.Context, token string) (*OAuthInfo, error) {
	if token == "" {
		return nil, ErrOAuthInvalid
	}
	if strings.HasPrefix(token, "oat_") {
		return c.verifyOpaqueOAuth(ctx, token)
	}
	claims, err := c.verifyJWT(ctx, token, "at+jwt", "application/at+jwt")
	if err != nil {
		return nil, ErrOAuthInvalid
	}
	return finishOAuth(token, claims.ClientID, claims.Scopes, claims.Subject)
}

func finishOAuth(token, clientID string, scopes []string, userID string) (*OAuthInfo, error) {
	// verifyClerkToken rejects tokens without a client id, scopes or user.
	if clientID == "" || scopes == nil || userID == "" {
		return nil, ErrOAuthInvalid
	}
	return &OAuthInfo{Token: token, Scopes: scopes, ClientID: clientID, UserID: userID}, nil
}

func (c *Clerk) verifyOpaqueOAuth(ctx context.Context, token string) (*OAuthInfo, error) {
	body, _ := json.Marshal(map[string]string{"access_token": token})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(c.APIURL, "/")+"/v1/oauth_applications/access_tokens/verify", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.SecretKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, ErrOAuthInvalid
	}
	var t struct {
		ClientID string   `json:"client_id"`
		Subject  string   `json:"subject"`
		Scopes   []string `json:"scopes"`
		Revoked  bool     `json:"revoked"`
		Expired  bool     `json:"expired"`
	}
	if err := json.NewDecoder(res.Body).Decode(&t); err != nil {
		return nil, fmt.Errorf("decode token verification: %w", err)
	}
	if t.Revoked || t.Expired {
		return nil, ErrOAuthInvalid
	}
	return finishOAuth(token, t.ClientID, t.Scopes, t.Subject)
}
