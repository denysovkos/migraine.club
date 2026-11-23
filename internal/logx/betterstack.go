package logx

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

// DefaultEndpoint is Better Stack's log ingestion host. LOGTAIL_ENDPOINT
// overrides it for sources that have their own ingesting host.
const DefaultEndpoint = "https://in.logs.betterstack.com"

// betterStack forwards every record to the wrapped handler and ships it to
// Better Stack in batches (at most 1000 records or one second, like the
// logtail transport).
type betterStack struct {
	next  slog.Handler
	attrs []slog.Attr
	group string
	ship  *shipper
}

type shipper struct {
	endpoint string
	token    string
	client   *http.Client

	mu      sync.Mutex
	pending []map[string]any
	timer   *time.Timer
}

func newBetterStack(next slog.Handler, token string) slog.Handler {
	endpoint := os.Getenv("LOGTAIL_ENDPOINT")
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	return &betterStack{next: next, ship: &shipper{endpoint: endpoint, token: token, client: &http.Client{Timeout: 30 * time.Second}}}
}

func (b *betterStack) Enabled(ctx context.Context, l slog.Level) bool { return b.next.Enabled(ctx, l) }

func (b *betterStack) Handle(ctx context.Context, r slog.Record) error {
	entry := map[string]any{
		"dt":      r.Time.UTC().Format(time.RFC3339Nano),
		"level":   r.Level.String(),
		"message": r.Message,
	}
	add := func(a slog.Attr) {
		key := a.Key
		if b.group != "" {
			key = b.group + "." + key
		}
		entry[key] = a.Value.Resolve().Any()
	}
	for _, a := range b.attrs {
		add(a)
	}
	r.Attrs(func(a slog.Attr) bool { add(a); return true })
	b.ship.enqueue(entry)
	return b.next.Handle(ctx, r)
}

func (b *betterStack) WithAttrs(attrs []slog.Attr) slog.Handler {
	c := *b
	c.next = b.next.WithAttrs(attrs)
	c.attrs = append(append([]slog.Attr{}, b.attrs...), attrs...)
	return &c
}

func (b *betterStack) WithGroup(name string) slog.Handler {
	c := *b
	c.next = b.next.WithGroup(name)
	c.group = name
	return &c
}

func (s *shipper) enqueue(entry map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending = append(s.pending, entry)
	if len(s.pending) >= 1000 {
		batch := s.pending
		s.pending = nil
		go s.send(batch)
		return
	}
	if s.timer == nil {
		s.timer = time.AfterFunc(time.Second, s.flush)
	}
}

func (s *shipper) flush() {
	s.mu.Lock()
	batch := s.pending
	s.pending = nil
	s.timer = nil
	s.mu.Unlock()
	if len(batch) > 0 {
		s.send(batch)
	}
}

func (s *shipper) send(batch []map[string]any) {
	body, err := json.Marshal(batch)
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, s.endpoint, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.token)
	res, err := s.client.Do(req)
	if err != nil {
		return
	}
	_ = res.Body.Close()
}
