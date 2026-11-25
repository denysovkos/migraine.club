package logx

import (
	"context"
	"errors"
	"log/slog"
	"strings"
)

// canceledHandler lowers to INFO, and marks with canceled=true, the ERROR
// records whose error is a canceled context. A request fails that way when
// its client goes away (a tab closed, a page left) before the answer:
// nothing is wrong with the server, so it is no alert either.
type canceledHandler struct{ next slog.Handler }

func newCanceledHandler(next slog.Handler) slog.Handler { return canceledHandler{next: next} }

func (h canceledHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return h.next.Enabled(ctx, l)
}

func (h canceledHandler) Handle(ctx context.Context, r slog.Record) error {
	if r.Level >= slog.LevelError && hasCanceledError(r) {
		r = r.Clone()
		r.Level = slog.LevelInfo
		r.AddAttrs(slog.Bool("canceled", true))
	}
	return h.next.Handle(ctx, r)
}

func (h canceledHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return canceledHandler{next: h.next.WithAttrs(attrs)}
}

func (h canceledHandler) WithGroup(name string) slog.Handler {
	return canceledHandler{next: h.next.WithGroup(name)}
}

func hasCanceledError(r slog.Record) bool {
	found := false
	r.Attrs(func(a slog.Attr) bool {
		if a.Key != "error" {
			return true
		}
		v := a.Value.Resolve()
		if err, ok := v.Any().(error); ok && errors.Is(err, context.Canceled) {
			found = true
		} else {
			// Some drivers report it as text only.
			found = strings.HasSuffix(v.String(), context.Canceled.Error())
		}
		return false
	})
	return found
}
