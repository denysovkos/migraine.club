package push_test

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/service/push"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

var pub, priv, p256dh, auth = keys()

// keys makes a fresh VAPID pair and subscription keys for each run.
func keys() (string, string, string, string) {
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		panic(err)
	}
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	secret := make([]byte, 16)
	_, _ = rand.Read(secret)
	return public, private, base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(secret)
}

func service(t *testing.T, client *http.Client) (*push.Service, *q.Queries) {
	pool := testdb.New(t)
	qs := q.New(pool)
	return &push.Service{Q: qs, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), HTTP: client,
		PublicKey: pub, PrivateKey: priv, Subject: "mailto:test@example.com", Now: time.Now}, qs
}

func TestConfigured(t *testing.T) {
	s := &push.Service{}
	ok, err := s.Configured()
	require.False(t, ok)
	require.NoError(t, err)
	for _, bad := range []push.Service{
		{PublicKey: pub, PrivateKey: priv, Subject: "nope"},
		{PublicKey: pub, PrivateKey: priv, Subject: "http://example.com"},
		{PublicKey: "abc", PrivateKey: priv, Subject: "mailto:a@b.c"},
		{PublicKey: pub, PrivateKey: "a=", Subject: "mailto:a@b.c"},
	} {
		_, err := bad.Configured()
		require.Error(t, err, bad.Subject)
	}
	good := push.Service{PublicKey: pub, PrivateKey: priv, Subject: "https://example.com"}
	ok, err = good.Configured()
	require.True(t, ok)
	require.NoError(t, err)
}

func TestSubscribeSendAndCleanup(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.True(t, strings.HasPrefix(r.Header.Get("Authorization"), "vapid t="))
		require.Equal(t, "aes128gcm", r.Header.Get("Content-Encoding"))
		require.Equal(t, "86400", r.Header.Get("TTL"))
		switch {
		case strings.HasSuffix(r.URL.Path, "gone"):
			w.WriteHeader(410)
		case strings.HasSuffix(r.URL.Path, "fail"):
			w.WriteHeader(500)
			_, _ = w.Write([]byte("boom"))
		default:
			w.WriteHeader(201)
		}
	}))
	t.Cleanup(srv.Close)
	s, qs := service(t, srv.Client())
	ctx := context.Background()
	// An http:// endpoint is still sent over TLS, as web-push did.
	plain := strings.Replace(srv.URL, "https://", "http://", 1)
	for _, ep := range []string{plain + "/ok", srv.URL + "/gone", srv.URL + "/fail"} {
		_, err := s.Subscribe(ctx, "u1", push.Subscription{Endpoint: ep, P256dh: p256dh, Auth: auth}, nil)
		require.NoError(t, err)
	}
	ua := "UA"
	exp := 1.7e12
	_, err := s.Subscribe(ctx, "u1", push.Subscription{Endpoint: plain + "/ok", P256dh: p256dh, Auth: auth, ExpirationTime: &exp}, &ua)
	require.NoError(t, err)
	frac := 1.5
	_, err = s.Subscribe(ctx, "u1", push.Subscription{Endpoint: srv.URL + "/frac", P256dh: p256dh, Auth: auth, ExpirationTime: &frac}, nil)
	require.Error(t, err, "bigint rejects a fraction, as it did for Drizzle")

	res, err := s.SendToUser(ctx, "u1", push.Payload{Title: "t", Body: "b"})
	require.NoError(t, err)
	require.Equal(t, [3]int{1, 1, 1}, [3]int{res.Sent, res.Removed, res.Failed})
	require.Equal(t, "boom", res.Errors[0].Error)
	require.Equal(t, 500, *res.Errors[0].StatusCode)
	subs, _ := qs.UserPushSubscriptions(ctx, "u1")
	require.Len(t, subs, 2, "the gone endpoint is removed")

	n, err := s.Unsubscribe(ctx, "u2", plain+"/ok")
	require.NoError(t, err)
	require.Equal(t, 0, n)
	subs, _ = qs.UserPushSubscriptions(ctx, "u1")
	require.Len(t, subs, 2, "another user's unsubscribe leaves the row alone")
	none, _ := s.SendToUser(ctx, "u2", push.Payload{})
	require.Empty(t, none.Errors)
}
