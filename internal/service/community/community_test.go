package community_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/service/community"
	"github.com/denysovkos/migraine.club/internal/testdb"
)

var now = time.Date(2026, 3, 18, 12, 0, 0, 0, time.UTC)

type env struct {
	s    *community.Service
	exec func(string, ...any)
	ctx  context.Context
}

func setup(t *testing.T) env {
	pool := testdb.New(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		_, err := pool.Exec(ctx, sql, args...)
		require.NoError(t, err, sql)
	}
	exec(`INSERT INTO "user" (id, display_name, community_handle, role) VALUES
		('me', 'Me', 'me_h', 'user'), ('doc', 'Dr', 'doc_h', 'doctor_verified'), ('pend', '', 'pend_h', 'doctor_pending'),
		('mod', 'Mod', NULL, 'moderator'), ('adm', 'Adm', NULL, 'admin')`)
	exec(`INSERT INTO doctor_verification_application (user_id, status, full_name, country, specialty, verification_method)
		VALUES ('doc', 'approved', 'Dr', 'DE', 'neurologist', 'license')`)
	return env{&community.Service{Q: q.New(pool), Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: func() time.Time { return now }}, exec, ctx}
}

func js(t *testing.T, v any) map[string]any {
	b, err := httpx.Marshal(v)
	require.NoError(t, err)
	var m map[string]any
	require.NoError(t, json.Unmarshal(b, &m))
	return m
}

func TestAuthorPublic(t *testing.T) {
	anon := `{"displayName":null,"isDoctor":false,"isDoctorVerified":false,"doctorSpecialty":null,"isAnonymous":true}`
	b, _ := httpx.Marshal(community.AuthorPublic(nil, false))
	require.Equal(t, anon, string(b))
	spec, handle := "gp", "h"
	b, _ = httpx.Marshal(community.AuthorPublic(&community.Author{DisplayName: "X", Role: "doctor_verified", DoctorSpecialty: &spec}, true))
	require.Equal(t, anon, string(b))
	b, _ = httpx.Marshal(community.AuthorPublic(&community.Author{CommunityHandle: &handle, Role: "doctor_pending", DoctorSpecialty: &spec}, false))
	require.Equal(t, `{"displayName":"h","isDoctor":true,"isDoctorVerified":false,"doctorSpecialty":null,"isAnonymous":false}`, string(b))
	b, _ = httpx.Marshal(community.AuthorPublic(&community.Author{DisplayName: "Dr", Role: "doctor_verified", DoctorSpecialty: &spec}, false))
	require.Equal(t, `{"displayName":"Dr","isDoctor":true,"isDoctorVerified":true,"doctorSpecialty":"gp","isAnonymous":false}`, string(b))
}

func TestParseTags(t *testing.T) {
	s := " a, b ,,c "
	require.Equal(t, []string{"a", "b", "c"}, community.ParseTags(&s))
	require.Equal(t, []string{}, community.ParseTags(nil))
}

func TestFeedVisibilityVotesAndModeration(t *testing.T) {
	e := setup(t)
	long := strings.Repeat("a", 239) + "😀tail"
	e.exec(`INSERT INTO community_post (id, author_id, title, body, tags, is_anonymous, score, visibility, created_at) VALUES
		('aaaaaaaa-0000-4000-8000-000000000001', 'doc', 'Doc', $1, 'x,y', false, 2, 'PUBLIC', '2026-03-18 11:00'),
		('aaaaaaaa-0000-4000-8000-000000000002', 'pend', 'Hidden', 'h', NULL, false, 9, 'HIDDEN', '2026-03-18 10:00'),
		('aaaaaaaa-0000-4000-8000-000000000003', 'me', 'Mine', 'm', 'y', true, 5, 'PUBLIC', '2026-03-18 09:00')`, long)
	e.exec(`INSERT INTO community_comment (post_id, author_id, body, visibility) VALUES
		('aaaaaaaa-0000-4000-8000-000000000001', 'pend', 'c1', 'PUBLIC'), ('aaaaaaaa-0000-4000-8000-000000000001', 'me', 'c2', 'HIDDEN')`)
	e.exec(`INSERT INTO community_report (post_id, reporter_id, reason) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'me', 'spam')`)

	posts, err := e.s.ListPosts(e.ctx, "me", community.ListQuery{Page: 1, Limit: 10, Sort: "new"})
	require.NoError(t, err)
	require.Len(t, posts, 2, "hidden posts are not listed for users")
	first := js(t, posts[0])
	require.Equal(t, strings.Repeat("a", 239)+"�…", first["bodyPreview"], "the cut leaves a lone surrogate")
	b, _ := httpx.Marshal(posts[0])
	require.Contains(t, string(b), `"bodyPreview":"`+strings.Repeat("a", 239)+`\ud83d…"`)
	require.InDelta(t, 2, first["commentCount"], 0)
	require.NotContains(t, first, "visibility")
	require.Equal(t, "neurologist", first["author"].(map[string]any)["doctorSpecialty"])
	require.Equal(t, true, js(t, posts[1])["isMine"])

	top, err := e.s.ListPosts(e.ctx, "mod", community.ListQuery{Page: 1, Limit: 10, Sort: "top"})
	require.NoError(t, err)
	require.Len(t, top, 3)
	require.Equal(t, "Hidden", js(t, top[0])["title"])
	require.InDelta(t, 1, js(t, top[2])["reportCount"], 0)

	tagged, _ := e.s.ListPosts(e.ctx, "me", community.ListQuery{Page: 1, Limit: 10, Sort: "new", Tag: "y", OnlyOwn: true})
	require.Len(t, tagged, 1)
	paged, _ := e.s.ListPosts(e.ctx, "me", community.ListQuery{Page: 2, Limit: 1, Sort: "new"})
	require.Equal(t, "Mine", js(t, paged[0])["title"])

	detail, err := e.s.PostWithComments(e.ctx, "me", "aaaaaaaa-0000-4000-8000-000000000001")
	require.NoError(t, err)
	require.Len(t, js(t, detail)["comments"], 1)
	modDetail, _ := e.s.PostWithComments(e.ctx, "mod", "aaaaaaaa-0000-4000-8000-000000000001")
	md := js(t, modDetail)
	require.Len(t, md["comments"], 2)
	require.InDelta(t, 1, md["reportCount"], 0)
	hidden, err := e.s.PostWithComments(e.ctx, "me", "aaaaaaaa-0000-4000-8000-000000000002")
	require.NoError(t, err)
	require.Nil(t, hidden)
	_, err = e.s.PostWithComments(e.ctx, "me", "not-a-uuid")
	require.Error(t, err)

	vote := func(v int32) map[string]any {
		r, err := e.s.Vote(e.ctx, "me", "aaaaaaaa-0000-4000-8000-000000000001", v)
		require.NoError(t, err)
		return js(t, r)
	}
	require.Equal(t, map[string]any{"score": 3.0, "viewerVote": 1.0}, vote(1))
	require.Equal(t, map[string]any{"score": 3.0, "viewerVote": 1.0}, vote(1))
	require.Equal(t, map[string]any{"score": 1.0, "viewerVote": -1.0}, vote(-1))
	require.Equal(t, map[string]any{"score": 2.0, "viewerVote": 0.0}, vote(0))
	none, err := e.s.Vote(e.ctx, "me", "aaaaaaaa-0000-4000-8000-000000000002", 1)
	require.NoError(t, err)
	require.Nil(t, none)

	ok, err := e.s.SetVisibility(e.ctx, "mod", ptr("aaaaaaaa-0000-4000-8000-000000000003"), nil, "HIDDEN")
	require.NoError(t, err)
	require.True(t, ok)
	items, err := e.s.HiddenContent(e.ctx, 50)
	require.NoError(t, err)
	require.Len(t, items, 3)
	// Sorted by hiddenAt, newest first; "Mine" was hidden at the test clock,
	// before the rows inserted with the database's now().
	last := js(t, items[2])
	require.Equal(t, "Mine", last["title"])
	require.Equal(t, true, last["author"].(map[string]any)["isAnonymous"])
	for i := 1; i < len(items); i++ {
		require.GreaterOrEqual(t, js(t, items[i-1])["hiddenAt"], js(t, items[i])["hiddenAt"])
	}

	reports, err := e.s.OpenReports(e.ctx, 50)
	require.NoError(t, err)
	r := js(t, reports[0])
	require.Equal(t, "post", r["contentType"])
	require.True(t, strings.HasPrefix(r["contentSnippet"].(string), "Doc: aaaa"))
	require.Equal(t, "doc_h", r["contentAuthor"].(map[string]any)["displayName"], "moderation shows the handle")
	done, err := e.s.ResolveReport(e.ctx, "mod", r["id"].(string), "RESOLVED")
	require.NoError(t, err)
	require.True(t, done)
	reports, _ = e.s.OpenReports(e.ctx, 50)
	require.Empty(t, reports)
}

func ptr(s string) *string { return &s }

func TestCreatePostCommentReportAndRoles(t *testing.T) {
	e := setup(t)
	e.exec(`INSERT INTO episode (id, user_id, start_time, intensity, pain_location, pain_type) VALUES
		(77, 'me', now(), 3, 'LEFT', 'PRESSURE'), (78, 'doc', now(), 3, 'LEFT', 'PRESSURE')`)
	foreign := int32(78)
	_, err := e.s.CreatePost(e.ctx, "me", community.PostInput{Title: "t", Body: "b", EpisodeID: &foreign})
	require.ErrorIs(t, err, community.ErrEpisodeForbidden)

	own := int32(77)
	post, err := e.s.CreatePost(e.ctx, "me", community.PostInput{Title: "Shared", Body: "b", Tags: []string{"a", "b"}, EpisodeID: &own})
	require.NoError(t, err)
	p := js(t, post)
	require.Equal(t, true, p["isFromEpisode"])
	require.Equal(t, []any{"a", "b"}, p["tags"])
	require.Equal(t, "Me", p["author"].(map[string]any)["displayName"])

	c, err := e.s.CreateComment(e.ctx, "doc", community.CommentInput{PostID: p["id"].(string), Body: "hi"})
	require.NoError(t, err)
	author := js(t, c)["author"].(map[string]any)
	require.Equal(t, true, author["isDoctorVerified"])
	require.Nil(t, author["doctorSpecialty"], "a full user row carries no specialty")

	require.NoError(t, e.s.CreateReport(e.ctx, "doc", community.ReportInput{PostID: ptr(p["id"].(string)), Reason: "spam"}))

	for uid, want := range map[string][2]bool{"me": {false, false}, "mod": {true, false}, "adm": {true, true}, "nobody": {false, false}} {
		isMod, err := e.s.IsModerator(e.ctx, uid)
		require.NoError(t, err)
		isAdmin, _ := e.s.IsAdmin(e.ctx, uid)
		require.Equal(t, want, [2]bool{isMod, isAdmin}, uid)
	}
	ok, err := e.s.SetRole(e.ctx, "adm", "me", "moderator")
	require.NoError(t, err)
	require.True(t, ok)
	ok, _ = e.s.SetRole(e.ctx, "adm", "nobody", "user")
	require.False(t, ok)
	users, err := e.s.Users(e.ctx, "PEND", 50)
	require.NoError(t, err)
	require.Len(t, users, 1)
}

func TestStatsTalliesTags(t *testing.T) {
	e := setup(t)
	e.exec(`INSERT INTO community_post (author_id, title, body, tags, created_at) VALUES
		('me', 't', 'b', 'sleep, stress', '2026-03-18 08:00'), ('doc', 't', 'b', 'sleep,__proto__', '2026-03-17 08:00'),
		('doc', 't', 'b', 'old', '2026-03-01 08:00')`)
	e.exec(`INSERT INTO community_post (author_id, title, body, tags, visibility, created_at) VALUES ('me', 't', 'b', 'hidden', 'HIDDEN', '2026-03-18 08:00')`)
	time.Local = time.UTC
	st, err := e.s.Stats(e.ctx, now)
	require.NoError(t, err)
	b, _ := httpx.Marshal(st)
	require.Equal(t, `{"postsToday":1,"activeUsersThisWeek":2,"topTagThisWeek":"sleep","trendingTags":[{"tag":"sleep","count":2},{"tag":"stress","count":1}]}`, string(b))
}
