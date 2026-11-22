package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

const testPK = "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk" // example.clerk.accounts.dev
const testIss = "https://example.clerk.accounts.dev"

type fakeClerk struct {
	key    *rsa.PrivateKey
	srv    *httptest.Server
	opaque map[string]map[string]any
	jwks   int
}

func newFakeClerk(t *testing.T) *fakeClerk {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	f := &fakeClerk{key: k, opaque: map[string]map[string]any{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/jwks", func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer sk_test_secret", r.Header.Get("Authorization"))
		f.jwks++
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
			"kid": "kid1", "kty": "RSA", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(k.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(k.E)).Bytes()),
		}}})
	})
	mux.HandleFunc("POST /v1/oauth_applications/access_tokens/verify", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		tok, ok := f.opaque[body["access_token"]]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"errors":[{"code":"resource_not_found"}]}`))
			return
		}
		_ = json.NewEncoder(w).Encode(tok)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeClerk) clerk(now time.Time) *Clerk {
	c := NewClerk("sk_test_secret", testPK)
	c.APIURL = f.srv.URL
	c.Now = func() time.Time { return now }
	return c
}

func (f *fakeClerk) sign(t *testing.T, header map[string]any, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = "kid1"
	for k, v := range header {
		tok.Header[k] = v
	}
	s, err := tok.SignedString(f.key)
	require.NoError(t, err)
	return s
}

func session(now time.Time, sub string) jwt.MapClaims {
	return jwt.MapClaims{"sub": sub, "iss": testIss, "sid": "sess_1", "azp": "http://localhost",
		"iat": now.Unix(), "nbf": now.Unix() - 10, "exp": now.Unix() + 60}
}

func req(cookies map[string]string, authz string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/x", nil)
	for k, v := range cookies {
		r.AddCookie(&http.Cookie{Name: k, Value: v})
	}
	if authz != "" {
		r.Header.Set("Authorization", authz)
	}
	return r
}

func TestCookieSuffixMatchesClerkShared(t *testing.T) {
	// Reference value computed with @clerk/shared getCookieSuffix.
	require.Equal(t, "PWKyINQF", CookieSuffix(testPK))
	require.Equal(t, "example.clerk.accounts.dev", frontendAPIHost(testPK))
}

func TestSessionFromCookie(t *testing.T) {
	f := newFakeClerk(t)
	now := time.Unix(1_800_000_000, 0)
	c := f.clerk(now)
	tok := f.sign(t, nil, session(now, "user_1"))
	uat := strconv.FormatInt(now.Unix()-100, 10)

	require.Equal(t, "user_1", c.SessionUserID(req(map[string]string{"__session": tok, "__client_uat": uat}, "")))

	// Both cookies are needed; the rest would be a handshake, i.e. signed out.
	require.Empty(t, c.SessionUserID(req(map[string]string{"__session": tok}, "")))
	require.Empty(t, c.SessionUserID(req(map[string]string{"__client_uat": uat}, "")))
	require.Empty(t, c.SessionUserID(req(map[string]string{"__session": tok, "__client_uat": "0"}, "")))

	// A session token issued before the client was last updated is stale.
	stale := strconv.FormatInt(now.Unix()+1, 10)
	require.Empty(t, c.SessionUserID(req(map[string]string{"__session": tok, "__client_uat": stale}, "")))
}

func TestSessionRejectsBadTokens(t *testing.T) {
	f := newFakeClerk(t)
	now := time.Unix(1_800_000_000, 0)
	c := f.clerk(now)
	uat := strconv.FormatInt(now.Unix()-100, 10)
	withCookie := func(tok string) string {
		return c.SessionUserID(req(map[string]string{"__session": tok, "__client_uat": uat}, ""))
	}

	expired := session(now, "u")
	expired["exp"] = now.Unix() - 6 // beyond the 5s skew
	require.Empty(t, withCookie(f.sign(t, nil, expired)))

	withinSkew := session(now, "u")
	withinSkew["exp"] = now.Unix() - 4
	require.Equal(t, "u", withCookie(f.sign(t, nil, withinSkew)))

	future := session(now, "u")
	future["nbf"] = now.Unix() + 60
	require.Empty(t, withCookie(f.sign(t, nil, future)))

	noSub := session(now, "")
	require.Empty(t, withCookie(f.sign(t, nil, noSub)))

	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	forged := jwt.NewWithClaims(jwt.SigningMethodRS256, session(now, "u"))
	forged.Header["kid"] = "kid1"
	s, _ := forged.SignedString(other)
	require.Empty(t, withCookie(s))

	require.Empty(t, withCookie("not-a-jwt"))

	// An OAuth access token is not a session token.
	require.Empty(t, withCookie(f.sign(t, map[string]any{"typ": "at+jwt"}, session(now, "u"))))
}

func TestSessionFromBearer(t *testing.T) {
	f := newFakeClerk(t)
	now := time.Unix(1_800_000_000, 0)
	c := f.clerk(now)
	tok := f.sign(t, nil, session(now, "user_2"))
	require.Equal(t, "user_2", c.SessionUserID(req(nil, "Bearer "+tok)))
	require.Empty(t, c.SessionUserID(req(nil, "Basic "+tok)))
	require.Empty(t, c.SessionUserID(req(nil, "Bearer oat_xyz")))
}

func TestSuffixedCookiesWin(t *testing.T) {
	f := newFakeClerk(t)
	now := time.Unix(1_800_000_000, 0)
	c := f.clerk(now)
	suffix := CookieSuffix(testPK)
	older := f.sign(t, nil, session(now.Add(-time.Minute), "old_user"))
	newer := f.sign(t, nil, session(now, "new_user"))
	uat := strconv.FormatInt(now.Unix()-3600, 10)
	got := c.SessionUserID(req(map[string]string{
		"__session": older, "__client_uat": uat,
		"__session_" + suffix: newer, "__client_uat_" + suffix: uat,
	}, ""))
	require.Equal(t, "new_user", got)
}

func TestJWKSIsCached(t *testing.T) {
	f := newFakeClerk(t)
	now := time.Unix(1_800_000_000, 0)
	c := f.clerk(now)
	tok := f.sign(t, nil, session(now, "u"))
	for range 3 {
		require.Equal(t, "u", c.SessionUserID(req(nil, "Bearer "+tok)))
	}
	require.Equal(t, 1, f.jwks)
}

func TestVerifyOAuthJWT(t *testing.T) {
	f := newFakeClerk(t)
	now := time.Unix(1_800_000_000, 0)
	c := f.clerk(now)
	claims := session(now, "user_3")
	claims["client_id"] = "client_1"
	claims["scp"] = []string{"mcp:read", "mcp:write"}
	tok := f.sign(t, map[string]any{"typ": "at+jwt"}, claims)

	info, err := c.VerifyOAuthToken(context.Background(), tok)
	require.NoError(t, err)
	require.Equal(t, &OAuthInfo{Token: tok, Scopes: []string{"mcp:read", "mcp:write"}, ClientID: "client_1", UserID: "user_3"}, info)

	delete(claims, "scp")
	claims["scope"] = "mcp:read"
	info, err = c.VerifyOAuthToken(context.Background(), f.sign(t, map[string]any{"typ": "application/at+jwt"}, claims))
	require.NoError(t, err)
	require.Equal(t, []string{"mcp:read"}, info.Scopes)

	// A session token (typ JWT) is not an OAuth token.
	_, err = c.VerifyOAuthToken(context.Background(), f.sign(t, nil, claims))
	require.ErrorIs(t, err, ErrOAuthInvalid)

	// verifyClerkToken requires scopes and a client id.
	delete(claims, "scope")
	_, err = c.VerifyOAuthToken(context.Background(), f.sign(t, map[string]any{"typ": "at+jwt"}, claims))
	require.ErrorIs(t, err, ErrOAuthInvalid)
}

func TestVerifyOpaqueOAuth(t *testing.T) {
	f := newFakeClerk(t)
	c := f.clerk(time.Now())
	f.opaque["oat_good"] = map[string]any{"client_id": "c", "subject": "user_4", "scopes": []string{"mcp:read"}, "revoked": false, "expired": false}
	f.opaque["oat_revoked"] = map[string]any{"client_id": "c", "subject": "user_4", "scopes": []string{"mcp:read"}, "revoked": true}

	info, err := c.VerifyOAuthToken(context.Background(), "oat_good")
	require.NoError(t, err)
	require.Equal(t, "user_4", info.UserID)

	_, err = c.VerifyOAuthToken(context.Background(), "oat_revoked")
	require.ErrorIs(t, err, ErrOAuthInvalid)
	_, err = c.VerifyOAuthToken(context.Background(), "oat_unknown")
	require.ErrorIs(t, err, ErrOAuthInvalid)
}

func TestMockResolverAndMiddleware(t *testing.T) {
	var seen string
	h := Middleware(Mock{UserID: "e2e_user_test_001"})(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = UserID(r.Context())
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	require.Equal(t, "e2e_user_test_001", seen)

	r := httptest.NewRequest("GET", "/", nil)
	// The Next proxy overwrote a client-sent x-e2e-mock-user header.
	r.Header.Set("x-e2e-mock-user", "other")
	h.ServeHTTP(httptest.NewRecorder(), r)
	require.Equal(t, "e2e_user_test_001", seen)
}
