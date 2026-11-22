// Package auth resolves who is calling.
//
// Browser requests carry Clerk's session JWT in the __session cookie (or a
// suffixed variant); API clients may send it as a Bearer token. MCP clients
// send a Clerk OAuth access token. Verification follows @clerk/backend's
// authenticateRequest for non-document requests: anything that would need a
// handshake redirect is simply signed out, which is what the Node API routes
// saw too.
package auth

import (
	"context"
	"crypto/rsa"
	"crypto/sha1" //nolint:gosec // Clerk derives the cookie suffix with SHA-1.
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// DefaultAPIURL is Clerk's Backend API.
const DefaultAPIURL = "https://api.clerk.com"

// clockSkew is @clerk/backend's DEFAULT_CLOCK_SKEW_IN_MS.
const clockSkew = 5 * time.Second

// Clerk verifies Clerk-issued tokens.
type Clerk struct {
	SecretKey      string
	PublishableKey string
	APIURL         string
	HTTP           *http.Client
	Now            func() time.Time

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

// NewClerk returns a verifier for the instance behind the given keys.
func NewClerk(secretKey, publishableKey string) *Clerk {
	return &Clerk{
		SecretKey:      secretKey,
		PublishableKey: publishableKey,
		APIURL:         DefaultAPIURL,
		HTTP:           &http.Client{Timeout: 10 * time.Second},
		Now:            time.Now,
	}
}

func (c *Clerk) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// jwksTTL matches @clerk/backend's one-hour JWKS cache.
const jwksTTL = time.Hour

func (c *Clerk) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if k, ok := c.keys[kid]; ok && c.now().Sub(c.fetchedAt) < jwksTTL {
		return k, nil
	}
	if err := c.fetchJWKS(ctx); err != nil {
		return nil, err
	}
	if k, ok := c.keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("unable to find a signing key in JWKS that matches the kid %q", kid)
}

func (c *Clerk) fetchJWKS(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(c.APIURL, "/")+"/v1/jwks", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.SecretKey)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("fetch JWKS: status %d", res.StatusCode)
	}
	var body struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range body.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			continue
		}
		e, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	c.keys = keys
	c.fetchedAt = c.now()
	return nil
}

// Claims are the parts of a verified Clerk JWT the server uses.
type Claims struct {
	Subject  string
	ClientID string
	Scopes   []string
	Iat      int64
	Raw      jwt.MapClaims
}

var errInvalidToken = errors.New("invalid token")

// verifyJWT checks signature (RS256), sub, exp, nbf and iat with Clerk's 5s
// skew, and the header type when headerTypes is non-empty.
func (c *Clerk) verifyJWT(ctx context.Context, token string, headerTypes ...string) (*Claims, error) {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithoutClaimsValidation(),
	)
	claims := jwt.MapClaims{}
	parsed, err := parser.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return c.key(ctx, kid)
	})
	if err != nil || !parsed.Valid {
		return nil, errInvalidToken
	}
	if len(headerTypes) > 0 {
		typ, _ := parsed.Header["typ"].(string)
		ok := false
		for _, h := range headerTypes {
			if typ == h {
				ok = true
			}
		}
		if !ok {
			return nil, errInvalidToken
		}
	}

	sub, _ := claims["sub"].(string)
	if sub == "" {
		return nil, errInvalidToken
	}
	now := c.now()
	exp, ok := numClaim(claims, "exp")
	if !ok || !time.Unix(exp, 0).After(now.Add(-clockSkew)) {
		return nil, errInvalidToken
	}
	if nbf, ok := numClaim(claims, "nbf"); ok && time.Unix(nbf, 0).After(now.Add(clockSkew)) {
		return nil, errInvalidToken
	}
	iat, hasIat := numClaim(claims, "iat")
	if hasIat && time.Unix(iat, 0).After(now.Add(clockSkew)) {
		return nil, errInvalidToken
	}

	out := &Claims{Subject: sub, Iat: iat, Raw: claims}
	out.ClientID, _ = claims["client_id"].(string)
	if scp, ok := claims["scp"].([]any); ok {
		for _, s := range scp {
			if str, ok := s.(string); ok {
				out.Scopes = append(out.Scopes, str)
			}
		}
	} else if scope, ok := claims["scope"].(string); ok && scope != "" {
		out.Scopes = strings.Split(scope, " ")
	}
	return out, nil
}

func numClaim(c jwt.MapClaims, k string) (int64, bool) {
	switch v := c[k].(type) {
	case float64:
		return int64(v), true
	case json.Number:
		n, err := v.Int64()
		return n, err == nil
	}
	return 0, false
}

// ---- session tokens ----

// CookieSuffix is @clerk/shared getCookieSuffix: the first 8 characters of
// the URL-safe base64 SHA-1 of the publishable key.
func CookieSuffix(publishableKey string) string {
	sum := sha1.Sum([]byte(publishableKey)) //nolint:gosec
	s := base64.StdEncoding.EncodeToString(sum[:])
	s = strings.NewReplacer("+", "-", "/", "_").Replace(s)
	return s[:8]
}

func cookie(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}

func decodePayload(token string) map[string]any {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}

func iatOf(token string) float64 {
	if p := decodePayload(token); p != nil {
		if v, ok := p["iat"].(float64); ok {
			return v
		}
	}
	return 0
}

// usesSuffixedCookies mirrors AuthenticateContext.usesSuffixedCookies for a
// production instance.
func (c *Clerk) usesSuffixedCookies(r *http.Request) bool {
	suffix := CookieSuffix(c.PublishableKey)
	suffixedClientUat := cookie(r, "__client_uat_"+suffix)
	clientUat := cookie(r, "__client_uat")
	suffixedSession := cookie(r, "__session_"+suffix)
	session := cookie(r, "__session")

	if session != "" {
		p := decodePayload(session)
		if p == nil || p["iss"] == nil || p["iss"] == "" {
			return false
		}
		if !c.tokenBelongsToInstance(p) {
			return true
		}
	}
	if suffixedClientUat == "" && suffixedSession == "" {
		return false
	}
	if suffixedClientUat != "0" && clientUat != "0" && iatOf(session) > iatOf(suffixedSession) {
		return false
	}
	if suffixedClientUat == "0" && clientUat != "0" {
		return false
	}
	return true
}

func (c *Clerk) tokenBelongsToInstance(payload map[string]any) bool {
	iss, ok := payload["iss"].(string)
	if !ok {
		return false
	}
	iss = strings.TrimPrefix(strings.TrimPrefix(iss, "https://"), "http://")
	return iss == frontendAPIHost(c.PublishableKey)
}

// frontendAPIHost decodes the Frontend API host from a publishable key.
func frontendAPIHost(pk string) string {
	key := strings.TrimPrefix(strings.TrimPrefix(pk, "pk_test_"), "pk_live_")
	raw, err := base64.StdEncoding.DecodeString(padBase64(key))
	if err != nil {
		raw, err = base64.RawStdEncoding.DecodeString(key)
		if err != nil {
			return ""
		}
	}
	return strings.TrimSuffix(string(raw), "$")
}

func padBase64(s string) string {
	if m := len(s) % 4; m != 0 {
		s += strings.Repeat("=", 4-m)
	}
	return s
}

func (c *Clerk) sessionCookies(r *http.Request) (session string, clientUat int64) {
	name := func(base string) string {
		if c.usesSuffixedCookies(r) {
			return base + "_" + CookieSuffix(c.PublishableKey)
		}
		return base
	}
	session = cookie(r, name("__session"))
	clientUat, _ = strconv.ParseInt(cookie(r, name("__client_uat")), 10, 64)
	return session, clientUat
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	scheme, token, found := strings.Cut(h, " ")
	if !found {
		return scheme
	}
	if scheme == "Bearer" {
		return token
	}
	return ""
}

// SessionUserID returns the signed-in user id for a request, or "".
func (c *Clerk) SessionUserID(r *http.Request) string {
	ctx := r.Context()
	if token := bearer(r); token != "" {
		if isMachineToken(token) {
			return ""
		}
		claims, err := c.verifyJWT(ctx, token)
		if err != nil {
			return ""
		}
		return claims.Subject
	}

	session, clientUat := c.sessionCookies(r)
	if session == "" || clientUat == 0 {
		// Missing either one would need a handshake; API requests are
		// signed out instead.
		return ""
	}
	if isMachineToken(session) {
		return ""
	}
	if int64(iatOf(session)) < clientUat {
		return ""
	}
	claims, err := c.verifyJWT(ctx, session)
	if err != nil {
		return ""
	}
	return claims.Subject
}

func isMachineToken(token string) bool {
	for _, p := range []string{"mt_", "oat_", "ak_"} {
		if strings.HasPrefix(token, p) {
			return true
		}
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	var h map[string]any
	if json.Unmarshal(raw, &h) != nil {
		return false
	}
	typ, _ := h["typ"].(string)
	if typ == "at+jwt" || typ == "application/at+jwt" {
		return true
	}
	if p := decodePayload(token); p != nil {
		if sub, _ := p["sub"].(string); strings.HasPrefix(sub, "mch_") {
			return true
		}
	}
	return false
}
