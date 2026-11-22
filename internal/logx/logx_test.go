package logx

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBetterStackShipsBatches(t *testing.T) {
	var mu sync.Mutex
	var got []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer tok", r.Header.Get("Authorization"))
		body, _ := io.ReadAll(r.Body)
		var batch []map[string]any
		require.NoError(t, json.Unmarshal(body, &batch))
		mu.Lock()
		got = append(got, batch...)
		mu.Unlock()
	}))
	defer srv.Close()
	t.Setenv("LOGTAIL_ENDPOINT", srv.URL)

	log := slog.New(newBetterStack(slog.NewJSONHandler(io.Discard, nil), "tok")).With("svc", "api")
	log.Info("hello", "n", 1)
	log.Warn("careful")

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(got) == 2
	}, 3*time.Second, 50*time.Millisecond)
	require.Equal(t, "hello", got[0]["message"])
	require.Equal(t, "INFO", got[0]["level"])
	require.Equal(t, "api", got[0]["svc"])
	require.EqualValues(t, 1, got[0]["n"])
	require.Equal(t, "WARN", got[1]["level"])
}
