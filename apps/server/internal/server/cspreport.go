package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// cspReports receives the browser's reports for the report-only policy
// (securityHeaders) and logs each distinct violation once an hour: which
// directive, and the origin (not the full URL) of what it blocked. A script
// from the site itself is logged with its path, and an inline one with the
// first 40 characters of its code, so a script something between the server
// and the browser injects can be told apart. That is the list of sources to
// allow before the policy is enforced.
type cspReports struct {
	log  *slog.Logger
	now  func() time.Time
	mu   sync.Mutex
	seen map[string]time.Time
}

const (
	cspReportMaxBytes = 16 << 10
	cspReportEvery    = time.Hour
	cspReportKeysMax  = 1000
)

func newCSPReports(log *slog.Logger, now func() time.Time) *cspReports {
	return &cspReports{log: log, now: now, seen: map[string]time.Time{}}
}

func (c *cspReports) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, cspReportMaxBytes))
	if err != nil {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	var report struct {
		Report struct {
			DocumentURI        string `json:"document-uri"`
			ViolatedDirective  string `json:"violated-directive"`
			EffectiveDirective string `json:"effective-directive"`
			BlockedURI         string `json:"blocked-uri"`
			ScriptSample       string `json:"script-sample"`
		} `json:"csp-report"`
	}
	if json.Unmarshal(body, &report) != nil || (report.Report.EffectiveDirective == "" && report.Report.ViolatedDirective == "") {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	directive := report.Report.EffectiveDirective
	if directive == "" {
		directive, _, _ = strings.Cut(report.Report.ViolatedDirective, " ")
	}
	blocked := blockedSource(report.Report.BlockedURI, report.Report.DocumentURI)
	attrs := []any{"directive", truncate(directive, 40), "blocked", blocked, "page", pagePath(report.Report.DocumentURI)}
	key := directive + " " + blocked
	// Only inline code: the sample of an eval is code built at run time,
	// which may hold the user's data.
	if blocked == "inline" && report.Report.ScriptSample != "" {
		sample := truncate(report.Report.ScriptSample, 40)
		attrs = append(attrs, "sample", sample)
		key += " " + sample
	}
	if c.first(key) {
		c.log.Warn("CSP violation (report only)", attrs...)
	}
	w.WriteHeader(http.StatusNoContent)
}

// first reports whether key was not logged within the last hour.
func (c *cspReports) first(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if t, ok := c.seen[key]; ok && now.Sub(t) < cspReportEvery {
		return false
	}
	if len(c.seen) >= cspReportKeysMax {
		c.seen = map[string]time.Time{}
	}
	c.seen[key] = now
	return true
}

// blockedSource is the origin of a blocked URL, or the keyword the browser
// reports for inline code, eval and data: URLs. A URL on the page's own
// origin keeps its path, with ids and tokens replaced as in the request log.
func blockedSource(raw, document string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		if s, _, _ := strings.Cut(raw, ":"); s != "" {
			return truncate(s, 40)
		}
		return "unknown"
	}
	origin := u.Scheme + "://" + u.Host
	if d, err := url.Parse(document); err == nil && d.Host == u.Host {
		return truncate(origin+pagePath(raw), 200)
	}
	return truncate(origin, 120)
}

// pagePath is the path of the page that reported, with ids and tokens
// replaced as in the request log.
func pagePath(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return logPath(&http.Request{URL: &url.URL{Path: u.Path}})
}
