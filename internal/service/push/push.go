// Package push is src/server/push/push.service: Web Push subscriptions and
// delivery (VAPID, aes128gcm), as the web-push package sent them.
package push

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// Payload is PushPayload; nil fields are left out like undefined ones.
type Payload struct {
	Title, Body            string
	Icon, Badge, URL, Tag  *string
	Renotify, RequireInter *bool
	Actions                []any
	Data                   *httpx.Object
}

func (p Payload) json() []byte {
	o := httpx.O("title", p.Title, "body", p.Body)
	for _, kv := range []struct {
		k string
		v *string
	}{{"icon", p.Icon}, {"badge", p.Badge}, {"url", p.URL}, {"tag", p.Tag}} {
		if kv.v != nil {
			o.Set(kv.k, *kv.v)
		}
	}
	if p.Renotify != nil {
		o.Set("renotify", *p.Renotify)
	}
	if p.RequireInter != nil {
		o.Set("requireInteraction", *p.RequireInter)
	}
	if p.Actions != nil {
		o.Set("actions", p.Actions)
	}
	if p.Data != nil {
		o.Set("data", p.Data)
	}
	b, _ := httpx.Marshal(o)
	return b
}

// SendError is one entry of SendPushResult.errors.
type SendError struct {
	Endpoint   string
	Error      string
	StatusCode *int
}

// Result is SendPushResult.
type Result struct {
	Sent, Removed, Failed int
	Errors                []SendError
}

// ErrorsJSON is the errors array as the API returned it.
func (r Result) ErrorsJSON() []any {
	out := make([]any, len(r.Errors))
	for i, e := range r.Errors {
		o := httpx.O("endpoint", e.Endpoint, "error", e.Error)
		if e.StatusCode != nil {
			o.Set("statusCode", *e.StatusCode)
		}
		out[i] = o
	}
	return out
}

// Service is PushService.
type Service struct {
	Q                              *q.Queries
	Log                            *slog.Logger
	HTTP                           *http.Client
	PublicKey, PrivateKey, Subject string
	Now                            func() time.Time

	mu          sync.Mutex
	initialized bool
}

var urlSafeBase64 = regexp.MustCompile(`^[A-Za-z0-9\-_]+$`)

func validateKey(key, kind string, size int) error {
	if !urlSafeBase64.MatchString(key) {
		return errors.New("Vapid " + kind + " key must be a URL safe Base 64 (without \"=\")")
	}
	b, err := base64.RawURLEncoding.DecodeString(key)
	if err != nil || len(b) != size {
		return errors.New("Vapid " + kind + " key should be " + map[int]string{65: "65", 32: "32"}[size] + " bytes long when decoded.")
	}
	return nil
}

// validate is setVapidDetails' checks; they threw on every call until one
// succeeded.
func (s *Service) validate() error {
	u, err := url.Parse(s.Subject)
	if err != nil || u.Scheme == "" {
		return errors.New("Vapid subject is not a valid URL. " + s.Subject)
	}
	if u.Scheme != "https" && u.Scheme != "mailto" {
		return errors.New("Vapid subject is not an https: or mailto: URL. " + s.Subject)
	}
	if err := validateKey(s.PublicKey, "public", 65); err != nil {
		return err
	}
	return validateKey(s.PrivateKey, "private", 32)
}

// Configured is isConfigured: false without keys, an error when the keys
// are malformed (setVapidDetails threw).
func (s *Service) Configured() (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.initialized {
		return true, nil
	}
	if s.PublicKey == "" || s.PrivateKey == "" || s.Subject == "" {
		return false, nil
	}
	if err := s.validate(); err != nil {
		return false, err
	}
	s.initialized = true
	return true, nil
}

func trunc50(s string) string { return jsx.SliceUTF16(s, 0, 50) }

// Subscription is the subscribe input.
type Subscription struct {
	Endpoint, P256dh, Auth string
	ExpirationTime         *float64
}

// Subscribe is subscribe: upsert by endpoint.
func (s *Service) Subscribe(ctx context.Context, uid string, sub Subscription, userAgent *string) (string, error) {
	s.Log.Info("Subscribing user to push notifications", "userId", uid, "endpoint", trunc50(sub.Endpoint))
	// Drizzle sent the number as String(n); Postgres rejects fractions and
	// exponent forms for bigint.
	var exp *string
	if sub.ExpirationTime != nil {
		v := jsx.FormatNumber(*sub.ExpirationTime)
		exp = &v
	}
	id, err := s.Q.UpsertPushSubscription(ctx, q.UpsertPushSubscriptionParams{UserID: uid, Endpoint: sub.Endpoint,
		P256dh: sub.P256dh, Auth: sub.Auth, ExpirationTime: exp, UserAgent: userAgent,
		Now: jsontime.New(s.Now())})
	if err != nil {
		return "", err
	}
	s.Log.Info("Push subscription created/updated", "userId", uid, "subscriptionId", id)
	return id, nil
}

// Unsubscribe is unsubscribe: only the caller's subscription for the
// endpoint is removed.
func (s *Service) Unsubscribe(ctx context.Context, uid, endpoint string) (int, error) {
	s.Log.Info("Unsubscribing user from push notifications", "userId", uid, "endpoint", trunc50(endpoint))
	rows, err := s.Q.DeleteOwnPushSubscription(ctx, endpoint, uid)
	if err != nil {
		return 0, err
	}
	n := int(rows)
	s.Log.Info("Push subscription(s) removed", "userId", uid, "deletedCount", n)
	return n, nil
}

// SendToUser is sendToUser.
func (s *Service) SendToUser(ctx context.Context, uid string, p Payload) (Result, error) {
	ok, err := s.Configured()
	if err != nil {
		return Result{}, err
	}
	if !ok {
		s.Log.Warn("Push notifications not configured, skipping send")
		return Result{Errors: []SendError{{Endpoint: "*", Error: "VAPID not configured"}}}, nil
	}
	subs, err := s.Q.UserPushSubscriptions(ctx, uid)
	if err != nil {
		return Result{}, err
	}
	if len(subs) == 0 {
		s.Log.Info("No push subscriptions found for user", "userId", uid)
		return Result{Errors: []SendError{}}, nil
	}
	s.Log.Info("Sending push notification to user", "userId", uid, "subscriptionCount", len(subs))
	return s.SendToSubscriptions(ctx, subs, p), nil
}

// SendToSubscriptions is sendToSubscriptions. Sends run concurrently, as
// Promise.all did; errors are recorded in completion order.
func (s *Service) SendToSubscriptions(ctx context.Context, subs []q.PushSubscription, p Payload) Result {
	res := Result{Errors: []SendError{}}
	body := p.json()
	var mu sync.Mutex
	var wg sync.WaitGroup
	var stale []string
	for _, sub := range subs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, respBody, err := s.send(ctx, sub, body)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil && status >= 200 && status < 300:
				res.Sent++
			case status == 410 || status == 404:
				s.Log.Info("Push subscription expired, marking for removal", "endpoint", trunc50(sub.Endpoint), "statusCode", status)
				stale = append(stale, sub.Endpoint)
				res.Removed++
			default:
				e := SendError{Endpoint: sub.Endpoint}
				if err != nil {
					e.Error = "Error: " + err.Error()
				} else {
					sc := status
					e.StatusCode = &sc
					e.Error = respBody
					if e.Error == "" {
						e.Error = "WebPushError: Received unexpected response code"
					}
				}
				s.Log.Error("Failed to send push notification", "endpoint", trunc50(sub.Endpoint), "statusCode", e.StatusCode, "body", respBody)
				res.Failed++
				res.Errors = append(res.Errors, e)
			}
		}()
	}
	wg.Wait()
	for _, ep := range stale {
		if err := s.Q.DeletePushSubscriptionsAt(ctx, ep); err != nil {
			s.Log.Error("Failed to remove stale subscription", "endpoint", trunc50(ep), "error", err)
		}
	}
	s.Log.Info("Push notification send complete", "sentCount", res.Sent, "removedCount", res.Removed, "failedCount", res.Failed)
	return res
}

// send posts one encrypted message: TTL 24 h, urgency normal, 10 s timeout.
func (s *Service) send(ctx context.Context, sub q.PushSubscription, body []byte) (int, string, error) {
	client := s.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	timed := *client
	timed.Timeout = 10 * time.Second
	// web-push always sent with https.request, whatever the endpoint's scheme.
	endpoint := sub.Endpoint
	if u, err := url.Parse(endpoint); err == nil && u.Scheme == "http" {
		u.Scheme = "https"
		if u.Port() == "" {
			u.Host += ":80"
		}
		endpoint = u.String()
	}
	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: endpoint, Keys: webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		HTTPClient: &timed, Subscriber: strings.TrimPrefix(s.Subject, "mailto:"), VAPIDPublicKey: s.PublicKey,
		VAPIDPrivateKey: s.PrivateKey, TTL: 60 * 60 * 24, Urgency: webpush.UrgencyNormal,
	})
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b), nil
}
