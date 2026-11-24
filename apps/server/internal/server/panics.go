package server

import (
	"net/http"

	"github.com/getsentry/sentry-go"
)

// reportPanics sends a handler's panic to Sentry with its route (no
// headers, query string or body), then panics again for the Recoverer,
// which answers 500 as before. Without a Sentry client it does nothing.
func reportPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				hub := sentry.CurrentHub().Clone()
				hub.Scope().SetTag("method", r.Method)
				hub.Scope().SetTag("route", logPath(r))
				hub.Recover(v)
				panic(v)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
