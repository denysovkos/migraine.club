package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/getsentry/sentry-go"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/stretchr/testify/require"
)

func TestReportPanics(t *testing.T) {
	transport := &sentry.MockTransport{}
	client, err := sentry.NewClient(sentry.ClientOptions{Dsn: "https://key@o1.ingest.de.sentry.io/1", Transport: transport})
	require.NoError(t, err)
	sentry.CurrentHub().BindClient(client)
	t.Cleanup(func() { sentry.CurrentHub().BindClient(nil) })

	r := chi.NewRouter()
	r.Use(middleware.Recoverer, reportPanics)
	r.Get("/api/share/{token}", func(http.ResponseWriter, *http.Request) { panic("kaboom") })
	r.Get("/ok", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/share/AbCdEfGhIjKlMnOpQrStUvWx?x=1", nil))
	require.Equal(t, http.StatusInternalServerError, w.Code, "the Recoverer still answers")

	events := transport.Events()
	require.Len(t, events, 1)
	require.Equal(t, "/api/share/{token}", events[0].Tags["route"])
	require.Equal(t, "GET", events[0].Tags["method"])

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ok", nil))
	require.Equal(t, http.StatusNoContent, w.Code)
	require.Len(t, transport.Events(), 1, "no event without a panic")
}
