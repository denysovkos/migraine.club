package logx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/getsentry/sentry-go"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/config"
)

func testHub(t *testing.T) (*sentry.Hub, *sentry.MockTransport) {
	t.Helper()
	transport := &sentry.MockTransport{}
	opts := clientOptions("https://key@o1.ingest.de.sentry.io/1", "test", "abc123")
	opts.Transport = transport
	client, err := sentry.NewClient(opts)
	require.NoError(t, err)
	return sentry.NewHub(client, sentry.NewScope()), transport
}

func TestSentryReportsErrorsWithoutUserData(t *testing.T) {
	hub, transport := testHub(t)
	log := slog.New(newSentryHandler(slog.NewJSONHandler(io.Discard, nil), hub)).With("userId", "user_secret", "attempt", 2)

	log.Info("fine")
	log.Warn("careful", "userId", "user_secret")
	dbErr := errors.New("Failed query: select * from episode where user_id = $1\nparams: user_secret,migraine with aura")
	log.Error("Error fetching recent episodes", "error", dbErr, "note", "took ibuprofen", "status", 500, "slow", true)

	events := transport.Events()
	require.Len(t, events, 1, "only ERROR records are reported")
	ev := events[0]
	require.Equal(t, sentry.LevelError, ev.Level)
	require.Equal(t, "Error fetching recent episodes", ev.Message)
	require.Equal(t, []string{"slog", "Error fetching recent episodes"}, ev.Fingerprint)
	require.Equal(t, "test", ev.Environment)
	require.Equal(t, "abc123", ev.Release)

	ctx := ev.Contexts["log"]
	require.Equal(t, "Failed query: select * from episode where user_id = $1\nparams: [removed]", ctx["error"])
	require.EqualValues(t, 500, ctx["status"])
	require.Equal(t, true, ctx["slow"])
	require.EqualValues(t, 2, ctx["attempt"])
	require.Equal(t, "userId,attempt,error,note,status,slow", ctx["attributes"])
	require.NotContains(t, ctx, "userId")
	require.NotContains(t, ctx, "note")

	require.Nil(t, ev.Request)
	require.Empty(t, ev.User.ID)
	require.Empty(t, ev.ServerName)
}

func TestSafeErrorText(t *testing.T) {
	require.Equal(t, "boom", SafeErrorText("boom"))
	require.Equal(t, "Failed query: x\nparams: [removed]", SafeErrorText("Failed query: x\nparams: a,b"))
	long := SafeErrorText(string(make([]byte, 600)))
	require.Len(t, []rune(long), 501)
}

func TestInitSentryIsOffWithoutDSN(t *testing.T) {
	hub, flush := InitSentry("", "test", "")
	require.Nil(t, hub)
	flush()
}

func TestNewWithAndWithoutSentry(t *testing.T) {
	require.NotNil(t, New(&config.Config{}, nil))
	hub, transport := testHub(t)
	New(&config.Config{}, hub).Error("boom")
	require.Len(t, transport.Events(), 1)
}

// A request the client gave up on fails with context.Canceled: nothing went
// wrong on the server, so it is logged as INFO and not reported.
func TestCanceledRequestsAreNotErrors(t *testing.T) {
	hub, transport := testHub(t)
	var buf bytes.Buffer
	log := slog.New(chain(slog.NewJSONHandler(&buf, nil), hub))

	log.Error("Error fetching user role", "error", context.Canceled)
	log.Error("Error fetching intake", "error", fmt.Errorf("query: %w", context.Canceled))
	log.Error("Error from a driver", "error", errors.New("failed to receive message: context canceled"))

	require.Empty(t, transport.Events())
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		require.Contains(t, line, `"level":"INFO"`)
		require.Contains(t, line, `"canceled":true`)
	}

	log.Error("Error fetching user role", "error", context.DeadlineExceeded)
	require.Len(t, transport.Events(), 1, "a timeout is still an error")
}
