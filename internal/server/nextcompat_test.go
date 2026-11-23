package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func serveRaw(h http.Handler, method, target string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/", nil)
	r.RequestURI = target
	r.URL, _ = url.ParseRequestURI(strings.ReplaceAll(target, `\`, "%5C"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestNextNormalize(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := nextNormalize(ok)
	for target, want := range map[string]string{
		"/dashboard/?a=1&b=2":         "/dashboard?a=1&b=2",
		"/api/episodes/":              "/api/episodes",
		"/fr/":                        "/fr",
		"//dashboard?x=1":             "/dashboard?x=1",
		"/dashboard//":                "/dashboard/",
		`/dash\board`:                 "/dash/board",
		"/help/ai-connector?x=1":      "/mcp?x=1",
		"/fr/help/ai-connector":       "/fr/mcp",
		"/help/ai-connector/":         "/help/ai-connector",
		"/anything/help/ai-connector": "/anything/mcp",
	} {
		w := serveRaw(h, http.MethodGet, target)
		require.Equal(t, http.StatusPermanentRedirect, w.Code, target)
		require.Equal(t, want, w.Header().Get("Location"), target)
		require.Equal(t, "0;url="+want, w.Header().Get("Refresh"), target)
		require.Equal(t, want, w.Body.String(), target)
	}
	// Any method; HEAD without a body.
	require.Equal(t, http.StatusPermanentRedirect, serveRaw(h, http.MethodPost, "/api/episodes/").Code)
	head := serveRaw(h, http.MethodHead, "/dashboard/")
	require.Equal(t, http.StatusPermanentRedirect, head.Code)
	require.Empty(t, head.Body.String())

	for _, target := range []string{"/", "/dashboard", "/fr/mcp", "/help/ai-connector/more", "/a/b/help/ai-connector"} {
		require.Equal(t, http.StatusOK, serveRaw(h, http.MethodGet, target).Code, target)
	}
}

func TestSentryTunnel(t *testing.T) {
	var got *http.Request
	var body string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"1"}`))
	}))
	defer upstream.Close()
	var dest []string
	orig := sentryIngest
	defer func() { sentryIngest = orig }()
	sentryIngest = func(org, region, project string) *url.URL {
		dest = append(dest, orig(org, region, project).String())
		u, _ := url.Parse(upstream.URL + "/api/" + project + "/envelope/?hsts=0")
		return u
	}
	notFound := http.NotFoundHandler()
	h := sentryTunnel(notFound)

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/monitoring?o=123&p=456", strings.NewReader("envelope")))
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"id":"1"}`, w.Body.String())
	require.Equal(t, "/api/456/envelope/", got.URL.Path)
	require.Equal(t, "0", got.URL.Query().Get("hsts"))
	require.Equal(t, "envelope", body)

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/monitoring?o=1&p=2&r=de", nil))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/monitoring?o=1&p=2&r=xyz", nil))
	require.Equal(t, []string{
		"https://o123.ingest.sentry.io/api/456/envelope/?hsts=0",
		"https://o1.ingest.de.sentry.io/api/2/envelope/?hsts=0",
		"https://o1.ingest.sentry.io/api/2/envelope/?hsts=0",
	}, dest)

	// An unreachable upstream: Next's plain 500.
	sentryIngest = func(string, string, string) *url.URL { u, _ := url.Parse("http://127.0.0.1:1/x"); return u }
	down := httptest.NewRecorder()
	h.ServeHTTP(down, httptest.NewRequest(http.MethodPost, "/monitoring?o=1&p=2", nil))
	require.Equal(t, http.StatusInternalServerError, down.Code)
	require.Equal(t, "Internal Server Error", down.Body.String())

	for _, target := range []string{"/monitoring", "/monitoring?o=1", "/monitoring?o=x&p=2"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, target, nil))
		require.Equal(t, http.StatusNotFound, w.Code, target)
	}
}

func TestUmamiScript(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		_, _ = w.Write([]byte("umami:" + r.URL.Path))
	}))
	defer upstream.Close()
	orig := umamiURL
	defer func() { umamiURL = orig }()
	umamiURL = func() *url.URL { u, _ := url.Parse(upstream.URL + "/script.js"); return u }

	w := httptest.NewRecorder()
	umamiScript().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/umami/script.js", nil))
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "umami:/script.js", w.Body.String())
	require.Equal(t, "https://cloud.umami.is/script.js", orig().String())
}
