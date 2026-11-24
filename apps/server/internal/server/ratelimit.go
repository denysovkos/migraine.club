package server

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/ratelimit"
)

// rateClass is one family of requests with its own budget per client.
type rateClass int

const (
	rateNone rateClass = iota
	rateRead
	rateWrite
	rateMCP
	rateReport
)

// rateLimitTable is the budget of each class per client. A dashboard load
// makes about 20 API reads, so a person never comes near these. They stop
// scripts and runaway loops.
var rateLimitTable = map[rateClass]ratelimit.Limit{
	rateRead:   {PerMinute: 300, Burst: 120},
	rateWrite:  {PerMinute: 60, Burst: 40},
	rateMCP:    {PerMinute: 120, Burst: 60},
	rateReport: {PerMinute: 30, Burst: 20},
}

// rateLimitMaxKeys caps the clients remembered per class.
const rateLimitMaxKeys = 100_000

// classify picks the budget a request counts against. Pages and static
// files are not limited, and neither are the cron endpoints, which only the
// scheduler calls with its secret.
func classify(r *http.Request) rateClass {
	p := r.URL.Path
	switch {
	case p == "/monitoring" || p == "/api/csp-report":
		return rateReport
	case !strings.HasPrefix(p, "/api/"):
		return rateNone
	case strings.HasPrefix(p, "/api/cron/"):
		return rateNone
	case p == "/api/mcp" || strings.HasPrefix(p, "/api/mcp/"):
		return rateMCP
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return rateRead
	}
	return rateWrite
}

// rateLimits answers 429 once a client spends its budget. A signed-in user
// is one client wherever they connect from. Anyone else is counted by
// address: the whole IPv4 address, or the /64 of an IPv6 one.
func rateLimits(factor int, now func() time.Time) func(http.Handler) http.Handler {
	if factor < 1 {
		factor = 1
	}
	limiters := map[rateClass]*ratelimit.Limiter{}
	for c, l := range rateLimitTable {
		limiters[c] = ratelimit.New(ratelimit.Limit{
			PerMinute: l.PerMinute * factor,
			Burst:     l.Burst * factor,
		}, now, rateLimitMaxKeys)
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			lim := limiters[classify(r)]
			if lim == nil {
				next.ServeHTTP(w, r)
				return
			}
			key := rateKey(r)
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			if ok, wait := lim.Allow(key); !ok {
				secs := int((wait + time.Second - 1) / time.Second)
				w.Header().Set("Retry-After", strconv.Itoa(max(secs, 1)))
				httpx.Error(w, http.StatusTooManyRequests, "Too many requests")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func rateKey(r *http.Request) string {
	if uid := auth.UserID(r.Context()); uid != "" {
		return "u:" + uid
	}
	raw, _, _ := strings.Cut(r.Header.Get("X-Forwarded-For"), ",")
	ip := net.ParseIP(strings.TrimSpace(raw))
	if ip == nil {
		return ""
	}
	if v4 := ip.To4(); v4 != nil {
		return "ip:" + v4.String()
	}
	return "ip:" + ip.Mask(net.CIDRMask(64, 128)).String()
}
