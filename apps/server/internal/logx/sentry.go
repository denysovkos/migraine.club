package logx

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
)

// sentryHandler forwards every record to the wrapped handler and reports
// ERROR records to Sentry.
//
// Only what cannot carry health or personal data leaves the server: the
// log message, the error text cut before the query parameters a database
// error appends, the names of the record's attributes, and the values of
// its numeric and boolean ones. Strings (user ids, names, notes) are not
// sent.
type sentryHandler struct {
	next  slog.Handler
	hub   *sentry.Hub
	attrs []slog.Attr
}

func newSentryHandler(next slog.Handler, hub *sentry.Hub) slog.Handler {
	return &sentryHandler{next: next, hub: hub}
}

func (h *sentryHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return h.next.Enabled(ctx, l)
}

func (h *sentryHandler) Handle(ctx context.Context, r slog.Record) error {
	if r.Level >= slog.LevelError {
		h.report(r)
	}
	return h.next.Handle(ctx, r)
}

func (h *sentryHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &sentryHandler{next: h.next.WithAttrs(attrs), hub: h.hub, attrs: append(append([]slog.Attr{}, h.attrs...), attrs...)}
}

func (h *sentryHandler) WithGroup(name string) slog.Handler {
	return &sentryHandler{next: h.next.WithGroup(name), hub: h.hub, attrs: h.attrs}
}

func (h *sentryHandler) report(r slog.Record) {
	ev := sentry.NewEvent()
	ev.Level = sentry.LevelError
	ev.Message = r.Message
	ev.Timestamp = r.Time
	// One issue per log message, whatever the error text says.
	ev.Fingerprint = []string{"slog", r.Message}
	extra := map[string]any{}
	var keys []string
	add := func(a slog.Attr) {
		keys = append(keys, a.Key)
		v := a.Value.Resolve()
		switch {
		case a.Key == "error":
			extra["error"] = SafeErrorText(v.String())
		case v.Kind() == slog.KindInt64, v.Kind() == slog.KindUint64, v.Kind() == slog.KindFloat64,
			v.Kind() == slog.KindBool, v.Kind() == slog.KindDuration:
			extra[a.Key] = v.Any()
		}
	}
	for _, a := range h.attrs {
		add(a)
	}
	r.Attrs(func(a slog.Attr) bool { add(a); return true })
	extra["attributes"] = strings.Join(keys, ",")
	ev.Contexts = map[string]sentry.Context{"log": extra}
	h.hub.CaptureEvent(ev)
}

// SafeErrorText is an error's text without what may hold user data: a
// database error's query parameters, and anything past 500 characters.
func SafeErrorText(s string) string {
	if i := strings.Index(s, "\nparams:"); i >= 0 {
		s = s[:i] + "\nparams: [removed]"
	}
	if len(s) > 500 {
		s = s[:500] + "…"
	}
	return s
}

// InitSentry starts the Sentry client when dsn is set and returns the hub
// to report to (nil when Sentry is off) and a flush for shutdown.
func InitSentry(dsn, environment, release string) (*sentry.Hub, func()) {
	if dsn == "" {
		return nil, func() {}
	}
	err := sentry.Init(clientOptions(dsn, environment, release))
	if err != nil {
		slog.Error("Sentry disabled", "error", err)
		return nil, func() {}
	}
	return sentry.CurrentHub(), func() { sentry.Flush(2 * time.Second) }
}

// clientOptions are the Sentry client settings: requests are described by
// the route only (see reportPanics in internal/server), so no headers,
// cookies, query strings, bodies or user details are sent.
func clientOptions(dsn, environment, release string) sentry.ClientOptions {
	return sentry.ClientOptions{
		Dsn:              dsn,
		Environment:      environment,
		Release:          release,
		AttachStacktrace: true,
		BeforeSend: func(ev *sentry.Event, _ *sentry.EventHint) *sentry.Event {
			ev.Request = nil
			ev.User = sentry.User{}
			ev.ServerName = ""
			return ev
		},
	}
}
