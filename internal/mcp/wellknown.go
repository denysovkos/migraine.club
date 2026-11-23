package mcp

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/denysovkos/migraine.club/internal/jsx"
)

// corsHeaders are @clerk/mcp-tools' metadata CORS headers.
var corsHeaders = [][2]string{
	{"Access-Control-Allow-Origin", "*"},
	{"Access-Control-Allow-Methods", "GET, OPTIONS"},
	{"Access-Control-Allow-Headers", "*"},
	{"Access-Control-Max-Age", "86400"},
}

// MetadataOptions is metadataCorsOptionsRequestHandler.
func MetadataOptions(w http.ResponseWriter, _ *http.Request) {
	for _, h := range corsHeaders {
		w.Header().Set(h[0], h[1])
	}
	w.WriteHeader(http.StatusOK)
}

// latin1 turns bytes into the string atob returned: one code point per byte.
func latin1(b []byte) string {
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

// FapiURL is deriveFapiUrl: the Frontend API host encoded in the
// publishable key.
func FapiURL(publishableKey string) (string, error) {
	k := publishableKey
	if strings.HasPrefix(k, "pk_test_") || strings.HasPrefix(k, "pk_live_") {
		k = k[len("pk_test_"):]
	}
	k = strings.NewReplacer("-", "+", "_", "/").Replace(k)
	for len(k)%4 != 0 {
		k += "="
	}
	b, err := atob(k)
	if err != nil {
		return "", err
	}
	return "https://" + strings.Replace(latin1(b), "$", "", 1), nil
}

// atob is forgiving-base64 decode.
func atob(s string) ([]byte, error) {
	s = strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\n' || r == '\f' || r == '\r' {
			return -1
		}
		return r
	}, s)
	if len(s)%4 == 0 {
		switch {
		case strings.HasSuffix(s, "=="):
			s = s[:len(s)-2]
		case strings.HasSuffix(s, "="):
			s = s[:len(s)-1]
		}
	}
	if len(s)%4 == 1 || strings.ContainsAny(s, "=") {
		return nil, errors.New("InvalidCharacterError")
	}
	return base64.RawStdEncoding.DecodeString(s)
}

func writeMetadata(w http.ResponseWriter, body any) {
	w.Header().Set("Cache-Control", "max-age=3600")
	w.Header().Set("Content-Type", "application/json")
	for _, h := range corsHeaders {
		w.Header().Set(h[0], h[1])
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(jsx.Stringify(body, ""))
}

// ProtectedResource is the /.well-known/oauth-protected-resource/mcp route:
// protectedResourceHandlerClerk with the public /api/mcp URL as resource.
func ProtectedResource(publishableKey, appURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if publishableKey == "" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		fapi, err := FapiURL(publishableKey)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var origin string
		if appURL != "" {
			u, err := url.Parse(appURL)
			if err != nil || u.Scheme == "" || u.Host == "" {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			origin = u.Scheme + "://" + u.Host
		} else if fh := r.Header.Get("X-Forwarded-Host"); fh != "" {
			proto := r.Header.Get("X-Forwarded-Proto")
			if proto == "" {
				proto = "https"
			}
			origin = proto + "://" + fh
		} else {
			origin = requestOrigin(r)
		}
		writeMetadata(w, jsx.NewJSONObject().
			Set("resource", origin+"/api/mcp").
			Set("authorization_servers", []any{fapi}).
			Set("token_types_supported", []any{"urn:ietf:params:oauth:token-type:access_token"}).
			Set("token_introspection_endpoint", fapi+"/oauth/token").
			Set("token_introspection_endpoint_auth_methods_supported", []any{"client_secret_post", "client_secret_basic"}).
			Set("jwks_uri", fapi+"/.well-known/jwks.json").
			Set("authorization_data_types_supported", []any{"oauth_scope"}).
			Set("authorization_data_locations_supported", []any{"header", "body"}).
			Set("key_challenges_supported", []any{jsx.NewJSONObject().
				Set("challenge_type", "urn:ietf:params:oauth:pkce:code_challenge").Set("challenge_algs", []any{"S256"})}).
			Set("service_documentation", "https://clerk.com/docs").
			Set("scopes_supported", []any{ScopeRead, ScopeWrite}))
	}
}

// AuthorizationServer is authServerMetadataHandlerClerk: Clerk's RFC 8414
// metadata, fetched and passed on.
func AuthorizationServer(publishableKey string, client *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fail := func() { w.WriteHeader(http.StatusInternalServerError) }
		if publishableKey == "" {
			fail()
			return
		}
		fapi, err := FapiURL(publishableKey)
		if err != nil {
			fail()
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, fapi+"/.well-known/oauth-authorization-server", nil)
		if err != nil {
			fail()
			return
		}
		res, err := client.Do(req)
		if err != nil {
			fail()
			return
		}
		defer res.Body.Close()
		b, err := io.ReadAll(res.Body)
		if err != nil {
			fail()
			return
		}
		v, err := jsx.ParseJSON([]byte(jsx.UTF8Decode(b, true)))
		if err != nil {
			fail()
			return
		}
		writeMetadata(w, v)
	}
}
