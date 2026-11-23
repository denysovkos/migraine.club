package spa

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/auth"
)

func newHandler(t *testing.T) *Handler {
	t.Helper()
	dist := fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><html><head><!--app-head--><script type=\"module\" src=\"/assets/index-1.js\"></script></head><body></body></html>")},
		"assets/index-1.js":    {Data: []byte("console.log(1)")},
		"favicon.ico":          {Data: []byte("ico")},
		"sw.js":                {Data: []byte("sw")},
		"robots.txt":           {Data: []byte("User-Agent: *")},
		"manifest.webmanifest": {Data: []byte("{}")},
		"heads.json": {Data: []byte(`{
			"/": {"en": "<title>Home</title>", "fr": "<title>Accueil</title>", "uk": "<title>Головна</title>"},
			"/dashboard/episodes/:id": {"en": "<title>Episode</title>", "fr": "<title>Épisode</title>", "uk": "<title>Епізод</title>"},
			"/sign-in/*?": {"en": "<title>Sign in</title>", "fr": "<title>Connexion</title>", "uk": "<title>Вхід</title>"},
			"/dashboard/episodes/new": {"en": "<title>New</title>", "fr": "<title>Nouveau</title>", "uk": "<title>Новий</title>"},
			"/share/:token": {"en": "<title>Report</title>"},
			"/admin/feature-requests": {"en": "<title>Admin</title>"}
		}`)},
		"routes.json": {Data: []byte(`[{"pattern":"/","localized":true},{"pattern":"/dashboard/episodes/:id","localized":true},
			{"pattern":"/dashboard/episodes/new","localized":true,"requiresUser":true},{"pattern":"/sign-in/*?","localized":true,"signedInRedirect":"/dashboard"},
			{"pattern":"/reports","localized":true,"redirect":"/dashboard/reports"},
			{"pattern":"/share/:token","localized":false},{"pattern":"/admin/feature-requests","localized":false,"requiresUser":true}]`)},
	}
	h, err := New(dist, Config{EnableInsights: true})
	require.NoError(t, err)
	return h
}

func get(h http.Handler, target string, headers ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, target, nil)
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestLocaleRouting(t *testing.T) {
	h := newHandler(t)
	cases := []struct {
		target, header, value string
		status                int
		location, cookie      string
	}{
		{"/", "", "", 200, "", "NEXT_LOCALE=en; Path=/; SameSite=Lax"},
		{"/", "Accept-Language", "fr-FR,fr;q=0.9", 307, "/fr", ""},
		{"/dashboard/episodes/new", "Accept-Language", "uk", 307, "/uk/dashboard/episodes/new", ""},
		{"/", "Cookie", "NEXT_LOCALE=uk", 307, "/uk", ""},
		{"/en/dashboard/episodes/new", "", "", 307, "/dashboard/episodes/new", "NEXT_LOCALE=en; Path=/; SameSite=Lax"},
		{"/en", "", "", 307, "/", "NEXT_LOCALE=en; Path=/; SameSite=Lax"},
		{"/fr", "Cookie", "NEXT_LOCALE=uk", 200, "", "NEXT_LOCALE=fr; Path=/; SameSite=Lax"},
		{"/en/terms?x=1", "", "", 307, "/terms?x=1", "NEXT_LOCALE=en; Path=/; SameSite=Lax"},
		{"/FR/dashboard/episodes/new", "", "", 307, "/fr/dashboard/episodes/new", "NEXT_LOCALE=fr; Path=/; SameSite=Lax"},
		{"/de/dashboard", "", "", 404, "", "NEXT_LOCALE=en; Path=/; SameSite=Lax"},
	}
	for _, c := range cases {
		t.Run(c.target+" "+c.value, func(t *testing.T) {
			var w *httptest.ResponseRecorder
			if c.header == "" {
				w = get(h, c.target)
			} else {
				w = get(h, c.target, c.header, c.value)
			}
			require.Equal(t, c.status, w.Code)
			require.Equal(t, c.location, w.Header().Get("Location"))
			require.Equal(t, c.cookie, w.Header().Get("Set-Cookie"))
		})
	}
}

func TestPages(t *testing.T) {
	h := newHandler(t)
	w := get(h, "/fr/dashboard/episodes/12")
	require.Equal(t, 200, w.Code)
	body := w.Body.String()
	require.Contains(t, body, `<head><title>Épisode</title><script>window.__APP_CONFIG__={"enableInsights":true}</script><script type="module"`)
	require.Equal(t, `<http://example.com/dashboard/episodes/12>; rel="alternate"; hreflang="en", <http://example.com/fr/dashboard/episodes/12>; rel="alternate"; hreflang="fr", <http://example.com/uk/dashboard/episodes/12>; rel="alternate"; hreflang="uk", <http://example.com/dashboard/episodes/12>; rel="alternate"; hreflang="x-default"`, w.Header().Get("Link"))
	require.Equal(t, "private, no-cache, no-store, max-age=0, must-revalidate", w.Header().Get("Cache-Control"))

	require.Contains(t, get(h, "/dashboard/episodes/new").Body.String(), "<title>New</title>", "static segments win over dynamic ones")
	require.Contains(t, get(h, "/sign-in").Body.String(), "<title>Sign in</title>", "an optional catch-all matches no segments")
	signedIn := httptest.NewRequest(http.MethodGet, "/uk/sign-in", nil)
	signedIn = signedIn.WithContext(auth.WithUserID(signedIn.Context(), "u1"))
	sw := httptest.NewRecorder()
	h.ServeHTTP(sw, signedIn)
	require.Equal(t, 307, sw.Code, "signed-in visitors skip the sign-in page")
	require.Equal(t, "/dashboard", sw.Header().Get("Location"))
	require.Contains(t, get(h, "/uk/sign-in/factor-one").Body.String(), "<title>Вхід</title>")
	require.Contains(t, get(h, "/share/abc").Body.String(), "<title>Report</title>", "share pages skip locale routing")
	require.Contains(t, get(h, "/admin/feature-requests").Body.String(), "<title>Admin</title>")

	rd := get(h, "/fr/reports")
	require.Equal(t, 307, rd.Code, "a redirect-only page answers 307")
	require.Equal(t, "/dashboard/reports", rd.Header().Get("Location"))
	require.NotEmpty(t, rd.Header().Get("Link"))

	nf := get(h, "/no-such-page")
	require.Equal(t, 404, nf.Code)
	require.Contains(t, nf.Body.String(), "<title>404: This page could not be found.</title>")
	require.Equal(t, 404, get(h, "/admin/nope").Code)
	require.Equal(t, 404, get(h, "/missing.png").Code)
}

func TestSignedOutVisitorsGoToSignIn(t *testing.T) {
	h := newHandler(t)
	serve := func(target string, signedOut bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, target, nil)
		if signedOut {
			r = r.WithContext(auth.WithSignedOut(r.Context()))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for target, want := range map[string]string{
		"/dashboard/episodes/new":    "/sign-in",
		"/uk/dashboard/episodes/new": "/uk/sign-in",
		"/fr/dashboard/episodes/new": "/fr/sign-in",
		"/admin/feature-requests":    "/sign-in",
	} {
		w := serve(target, true)
		require.Equal(t, 307, w.Code, target)
		require.Equal(t, want, w.Header().Get("Location"), target)
	}
	// Possibly signed in (clerk-js decides in the browser), or a page
	// without the guard: the page itself.
	require.Equal(t, 200, serve("/uk/dashboard/episodes/new", false).Code)
	require.Equal(t, 200, serve("/fr/dashboard/episodes/12", true).Code)
}

func TestStaticFiles(t *testing.T) {
	h := newHandler(t)
	for target, want := range map[string][2]string{
		"/assets/index-1.js":    {"application/javascript; charset=UTF-8", "public, max-age=31536000, immutable"},
		"/favicon.ico":          {"image/x-icon", "public, max-age=0"},
		"/sw.js":                {"application/javascript; charset=UTF-8", "public, max-age=0"},
		"/manifest.webmanifest": {"application/manifest+json", "public, max-age=0"},
		"/robots.txt":           {"text/plain; charset=UTF-8", "public, max-age=0, must-revalidate"},
	} {
		w := get(h, target)
		require.Equal(t, 200, w.Code, target)
		require.Equal(t, want[0], w.Header().Get("Content-Type"), target)
		require.Equal(t, want[1], w.Header().Get("Cache-Control"), target)
	}
	require.Equal(t, 404, get(h, "/heads.json").Code, "build metadata is not served")
	require.False(t, strings.Contains(get(h, "/index.html").Body.String(), "<!--app-head-->"))
}

func TestAcceptLanguage(t *testing.T) {
	require.Equal(t, "fr", acceptLanguageLocale("de;q=0.9, fr-CA;q=0.8, en;q=0.5"))
	require.Equal(t, "en", acceptLanguageLocale("de"))
	require.Equal(t, "uk", acceptLanguageLocale("en;q=0, uk"))
	require.Empty(t, acceptLanguageLocale(""), "no header: undefined, so the cookie gets set")
}
