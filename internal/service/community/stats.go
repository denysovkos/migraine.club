package community

import (
	"context"
	"strings"
	"time"

	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// Stats is GET /api/community/stats. now is in the server's local zone:
// "today" starts at local midnight, as `new Date(y, m, d)` did.
func (s *Service) Stats(ctx context.Context, now time.Time) (*httpx.Object, error) {
	now = now.Truncate(time.Millisecond)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekAgo := now.Add(-7 * 24 * time.Hour)

	today, err := s.Q.StatsPostsSince(ctx, jsontime.New(startOfToday))
	if err != nil {
		return nil, err
	}
	authors, err := s.Q.StatsActiveAuthors(ctx, jsontime.New(weekAgo))
	if err != nil {
		return nil, err
	}
	tagRows, err := s.Q.StatsRecentTags(ctx, jsontime.New(weekAgo))
	if err != nil {
		return nil, err
	}
	tally := jsx.NewTally()
	for _, t := range tagRows {
		if t == nil || *t == "" {
			continue
		}
		for _, tag := range strings.Split(*t, ",") {
			if tag = jsx.Trim(tag); tag != "" {
				tally.Inc(tag)
			}
		}
	}
	entries := tally.Entries()
	jsx.ByCountDesc(entries)
	if len(entries) > 5 {
		entries = entries[:5]
	}
	trending := make([]any, len(entries))
	for i, e := range entries {
		trending[i] = httpx.O("tag", e.Key, "count", e.Val)
	}
	var top any
	if len(entries) > 0 {
		top = entries[0].Key
	}
	return httpx.O("postsToday", today, "activeUsersThisWeek", len(authors), "topTagThisWeek", top,
		"trendingTags", trending), nil
}
