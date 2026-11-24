package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/auth"
)

func TestClassify(t *testing.T) {
	for _, tc := range []struct {
		method, path string
		want         rateClass
	}{
		{"GET", "/", rateNone},
		{"GET", "/dashboard/diary", rateNone},
		{"GET", "/assets/index.js", rateNone},
		{"GET", "/healthz", rateNone},
		{"GET", "/api/cron/daily", rateNone},
		{"POST", "/api/cron/daily", rateNone},
		{"GET", "/api/episodes", rateRead},
		{"HEAD", "/api/episodes", rateRead},
		{"OPTIONS", "/api/mcpx", rateRead},
		{"POST", "/api/episodes", rateWrite},
		{"PUT", "/api/user/profile", rateWrite},
		{"DELETE", "/api/share/abc", rateWrite},
		{"GET", "/api/share/abc", rateRead},
		{"POST", "/api/mcp", rateMCP},
		{"GET", "/api/mcp", rateMCP},
		{"POST", "/api/csp-report", rateReport},
		{"POST", "/monitoring", rateReport},
	} {
		got := classify(httptest.NewRequest(tc.method, tc.path, nil))
		require.Equal(t, tc.want, got, "%s %s", tc.method, tc.path)
	}
}

func TestRateKey(t *testing.T) {
	req := func(xff, uid string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/api/x", nil)
		if xff != "" {
			r.Header.Set("X-Forwarded-For", xff)
		}
		if uid != "" {
			r = r.WithContext(auth.WithUserID(r.Context(), uid))
		}
		return r
	}
	require.Equal(t, "u:user_1", rateKey(req("203.0.113.7", "user_1")), "a signed-in user is one client")
	require.Equal(t, "ip:203.0.113.7", rateKey(req("203.0.113.7, 10.0.0.1", "")))
	require.Equal(t, "ip:2001:db8:1:2::", rateKey(req("2001:db8:1:2:aaaa::1", "")), "IPv6 by its /64")
	require.Empty(t, rateKey(req("", "")))
	require.Empty(t, rateKey(req("garbage", "")))
}

func TestRateLimits(t *testing.T) {
	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	h := rateLimits(1, func() time.Time { return now })(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	do := func(method, path, uid, ip string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("X-Forwarded-For", ip)
		if uid != "" {
			r = r.WithContext(auth.WithUserID(r.Context(), uid))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	write := rateLimitTable[rateWrite]
	for i := range write.Burst {
		require.Equal(t, http.StatusNoContent, do("POST", "/api/episodes", "alice", "203.0.113.1").Code, "write %d", i)
	}
	w := do("POST", "/api/episodes", "alice", "198.51.100.9")
	require.Equal(t, http.StatusTooManyRequests, w.Code, "a new address does not reset a user's budget")
	require.Equal(t, "1", w.Header().Get("Retry-After"))
	require.JSONEq(t, `{"error":"Too many requests"}`, w.Body.String())

	require.Equal(t, http.StatusNoContent, do("GET", "/api/episodes", "alice", "203.0.113.1").Code, "reads have their own budget")
	require.Equal(t, http.StatusNoContent, do("POST", "/api/episodes", "bob", "203.0.113.1").Code, "another user on the same address is not limited")
	require.Equal(t, http.StatusNoContent, do("POST", "/api/cron/daily", "", "203.0.113.1").Code)
	require.Equal(t, http.StatusNoContent, do("GET", "/dashboard", "alice", "203.0.113.1").Code)

	now = now.Add(time.Second)
	require.Equal(t, http.StatusNoContent, do("POST", "/api/episodes", "alice", "203.0.113.1").Code, "the budget refills")

	report := rateLimitTable[rateReport]
	for range report.Burst {
		require.Equal(t, http.StatusNoContent, do("POST", "/api/csp-report", "", "192.0.2.5").Code)
	}
	require.Equal(t, http.StatusTooManyRequests, do("POST", "/api/csp-report", "", "192.0.2.5").Code)
	require.Equal(t, http.StatusNoContent, do("POST", "/api/csp-report", "", "192.0.2.6").Code, "anonymous clients are counted by address")
}

func TestRateLimitFactorScalesTheBudget(t *testing.T) {
	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	h := rateLimits(3, func() time.Time { return now })(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	burst := rateLimitTable[rateReport].Burst * 3
	codes := map[int]int{}
	for range burst + 1 {
		r := httptest.NewRequest(http.MethodPost, "/api/csp-report", nil)
		r.Header.Set("X-Forwarded-For", "192.0.2.5")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		codes[w.Code]++
	}
	require.Equal(t, map[int]int{http.StatusNoContent: burst, http.StatusTooManyRequests: 1}, codes)
}
