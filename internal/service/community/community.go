// Package community is src/services/CommunityService and ModerationService:
// the community feed, votes, comments, reports and moderation tools.
package community

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// ErrEpisodeForbidden is EPISODE_NOT_FOUND_OR_FORBIDDEN.
var ErrEpisodeForbidden = errors.New("EPISODE_NOT_FOUND_OR_FORBIDDEN")

// Service is CommunityService plus ModerationService.
type Service struct {
	Q   *q.Queries
	Log *slog.Logger
	Now func() time.Time
}

// Author is the user a post or comment was written by, as the services
// rebuilt it; nil means no user.
type Author struct {
	DisplayName     string
	CommunityHandle *string
	Role            string
	DoctorSpecialty *string
}

func isDoctorRole(role string) bool {
	return role == "doctor_pending" || role == "doctor_verified" || role == "doctor_rejected"
}

var anonymous = func() *httpx.Object {
	return httpx.O("displayName", nil, "isDoctor", false, "isDoctorVerified", false, "doctorSpecialty", nil, "isAnonymous", true)
}

// AuthorPublic is CommunityService's mapAuthorPublic.
func AuthorPublic(a *Author, isAnonymous bool) *httpx.Object {
	if a == nil || isAnonymous {
		return anonymous()
	}
	var name any
	if a.DisplayName != "" {
		name = a.DisplayName
	} else if a.CommunityHandle != nil {
		name = *a.CommunityHandle
	}
	var specialty any
	if a.Role == "doctor_verified" && a.DoctorSpecialty != nil {
		specialty = *a.DoctorSpecialty
	}
	return httpx.O("displayName", name, "isDoctor", isDoctorRole(a.Role), "isDoctorVerified", a.Role == "doctor_verified",
		"doctorSpecialty", specialty, "isAnonymous", false)
}

// joinedAuthor is the user the list and detail queries rebuilt from a left
// join: displayName `?? ”`, role `?? 'user'`.
func joinedAuthor(name, handle, role, specialty *string) *Author {
	a := &Author{CommunityHandle: handle, Role: "user", DoctorSpecialty: specialty}
	if name != nil {
		a.DisplayName = *name
	}
	if role != nil {
		a.Role = *role
	}
	return a
}

// ParseTags is parseTags.
func ParseTags(tags *string) []string {
	out := []string{}
	if tags == nil || *tags == "" {
		return out
	}
	for _, t := range strings.Split(*tags, ",") {
		if t = jsx.Trim(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func serializeTags(tags []string) *string {
	if len(tags) == 0 {
		return nil
	}
	s := strings.Join(tags, ",")
	return &s
}

// UserRole is getUserRole; "" when the user does not exist.
func (s *Service) UserRole(ctx context.Context, uid string) (string, error) {
	role, err := s.Q.UserRole(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return role, err
}

// IsModerator is isModerator.
func (s *Service) IsModerator(ctx context.Context, uid string) (bool, error) {
	role, err := s.UserRole(ctx, uid)
	return role == "moderator" || role == "admin", err
}

// IsAdmin is isAdmin.
func (s *Service) IsAdmin(ctx context.Context, uid string) (bool, error) {
	role, err := s.UserRole(ctx, uid)
	return role == "admin", err
}

// PostInput is CreateCommunityPostInput.
type PostInput struct {
	Title, Body string
	IsAnonymous bool
	Tags        []string
	EpisodeID   *int32
}

// CreatePost is createPost.
func (s *Service) CreatePost(ctx context.Context, uid string, in PostInput) (*httpx.Object, error) {
	if in.EpisodeID != nil {
		_, err := s.Q.OwnEpisodeExists(ctx, *in.EpisodeID, uid)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Log.Warn("Attempt to share episode that does not belong to user", "authorId", uid, "episodeId", *in.EpisodeID)
			return nil, ErrEpisodeForbidden
		}
		if err != nil {
			return nil, err
		}
	}
	id, err := s.Q.InsertCommunityPost(ctx, q.InsertCommunityPostParams{AuthorID: uid, EpisodeID: in.EpisodeID,
		Title: in.Title, Body: in.Body, Tags: serializeTags(in.Tags), IsAnonymous: in.IsAnonymous,
		IsFromEpisode: in.EpisodeID != nil})
	if err != nil {
		return nil, err
	}
	s.Log.Info("Community post created", "postId", id, "authorId", uid, "hasEpisode", in.EpisodeID != nil)
	detail, err := s.PostWithComments(ctx, uid, id)
	if err != nil {
		return nil, err
	}
	if detail == nil {
		return nil, errors.New("FAILED_TO_LOAD_CREATED_POST")
	}
	return detail, nil
}

// ListQuery is ListCommunityPostsQuery after parsing.
type ListQuery struct {
	Page, Limit float64
	Sort, Tag   string
	OnlyOwn     bool
}

type listRow struct {
	ID, Title, Body                                 string
	EpisodeID                                       *int32
	Tags                                            *string
	Score                                           int32
	IsFromEpisode, IsAnonymous                      bool
	CreatedAt                                       time.Time
	AuthorID, Visibility                            string
	UserID, DisplayName, Handle, Role, DocSpecialty *string
}

// ListPosts is listPosts.
func (s *Service) ListPosts(ctx context.Context, viewer string, qy ListQuery) ([]any, error) {
	page, limit := qy.Page, qy.Limit
	offset := (page - 1) * limit
	isMod := false
	if viewer != "" {
		var err error
		if isMod, err = s.IsModerator(ctx, viewer); err != nil {
			return nil, err
		}
	}
	var tag, author *string
	if qy.Tag != "" {
		t := "%" + qy.Tag + "%"
		tag = &t
	}
	if qy.OnlyOwn && viewer != "" {
		author = &viewer
	}
	var rows []listRow
	if qy.Sort == "top" {
		res, err := s.Q.ListCommunityPostsTop(ctx, q.ListCommunityPostsTopParams{Moderator: isMod, Tag: tag, Author: author,
			Lim: int64(limit), Off: int64(offset)})
		if err != nil {
			return nil, err
		}
		for _, r := range res {
			rows = append(rows, listRow{r.ID, r.Title, r.Body, r.EpisodeID, r.Tags, r.Score, r.IsFromEpisode, r.IsAnonymous,
				r.CreatedAt.Time, r.AuthorID, r.Visibility, r.UserID, r.DisplayName, r.CommunityHandle, r.UserRole, r.DoctorSpecialty})
		}
	} else {
		res, err := s.Q.ListCommunityPostsNew(ctx, q.ListCommunityPostsNewParams{Moderator: isMod, Tag: tag, Author: author,
			Lim: int64(limit), Off: int64(offset)})
		if err != nil {
			return nil, err
		}
		for _, r := range res {
			rows = append(rows, listRow{r.ID, r.Title, r.Body, r.EpisodeID, r.Tags, r.Score, r.IsFromEpisode, r.IsAnonymous,
				r.CreatedAt.Time, r.AuthorID, r.Visibility, r.UserID, r.DisplayName, r.CommunityHandle, r.UserRole, r.DoctorSpecialty})
		}
	}

	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	votes, comments, reports := map[string]int32{}, map[string]int64{}, map[string]int64{}
	if viewer != "" && len(ids) > 0 {
		vs, err := s.Q.ViewerVotes(ctx, viewer, ids)
		if err != nil {
			return nil, err
		}
		for _, v := range vs {
			votes[v.PostID] = v.Value
		}
	}
	if len(ids) > 0 {
		cs, err := s.Q.CommentCounts(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, c := range cs {
			comments[c.PostID] = c.Count
		}
	}
	if isMod && len(ids) > 0 {
		rs, err := s.Q.OpenReportCounts(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, r := range rs {
			if r.PostID != nil && *r.PostID != "" {
				reports[*r.PostID] = r.Count
			}
		}
	}

	out := make([]any, len(rows))
	for i, r := range rows {
		var author *Author
		if r.UserID != nil && *r.UserID != "" {
			author = joinedAuthor(r.DisplayName, r.Handle, r.Role, r.DocSpecialty)
		}
		var preview any = r.Body
		if jsx.Len(r.Body) > 240 {
			preview = jsx.JSString(jsx.SliceUTF16(r.Body, 0, 240) + "…")
		}
		o := httpx.O("id", r.ID, "title", r.Title, "bodyPreview", preview, "score", r.Score, "episodeId", r.EpisodeID,
			"tags", ParseTags(r.Tags), "isFromEpisode", r.IsFromEpisode, "createdAt", jsontime.Format(r.CreatedAt),
			"author", AuthorPublic(author, r.IsAnonymous), "viewerVote", votes[r.ID], "commentCount", comments[r.ID],
			"isMine", viewer != "" && r.AuthorID == viewer)
		if isMod {
			o.Set("visibility", r.Visibility).Set("reportCount", reports[r.ID])
		}
		out[i] = o
	}
	return out, nil
}

// PostWithComments is getPostWithComments; nil when not visible to viewer.
func (s *Service) PostWithComments(ctx context.Context, viewer, postID string) (*httpx.Object, error) {
	isMod := false
	if viewer != "" {
		var err error
		if isMod, err = s.IsModerator(ctx, viewer); err != nil {
			return nil, err
		}
	}
	row, err := s.Q.CommunityPostDetail(ctx, postID, isMod)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var viewerVote int32
	if viewer != "" {
		v, err := s.Q.ViewerVote(ctx, postID, viewer)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		viewerVote = v
	}
	var author *Author
	if !row.IsAnonymous {
		author = joinedAuthor(row.DisplayName, row.CommunityHandle, row.UserRole, row.DoctorSpecialty)
	}

	crs, err := s.Q.PostComments(ctx, postID, isMod)
	if err != nil {
		return nil, err
	}
	comments := make([]any, len(crs))
	for i, c := range crs {
		var ca *Author
		if c.UserID != nil && *c.UserID != "" {
			ca = joinedAuthor(c.DisplayName, c.CommunityHandle, c.UserRole, c.DoctorSpecialty)
		}
		o := httpx.O("id", c.ID, "postId", c.PostID, "parentCommentId", c.ParentCommentID, "body", c.Body,
			"createdAt", jsontime.Format(c.CreatedAt.Time), "author", AuthorPublic(ca, c.IsAnonymous))
		if isMod {
			o.Set("visibility", c.Visibility).Set("isMine", viewer != "" && c.CommentAuthorID == viewer)
		}
		comments[i] = o
	}
	var reportCount int64
	if isMod {
		if reportCount, err = s.Q.OpenReportCountForPost(ctx, &postID); err != nil {
			return nil, err
		}
	}
	d := httpx.O("id", row.ID, "title", row.Title, "body", row.Body, "score", row.Score, "tags", ParseTags(row.Tags),
		"isFromEpisode", row.IsFromEpisode, "episodeId", row.EpisodeID, "createdAt", jsontime.Format(row.CreatedAt.Time),
		"updatedAt", jsontime.Format(row.UpdatedAt.Time), "author", AuthorPublic(author, row.IsAnonymous),
		"viewerVote", viewerVote, "comments", comments)
	if isMod {
		d.Set("visibility", row.Visibility).Set("reportCount", reportCount)
	}
	return d, nil
}

// Vote is voteOnPost; nil when the post is missing or not public.
func (s *Service) Vote(ctx context.Context, uid, postID string, value int32) (*httpx.Object, error) {
	post, err := s.Q.PostForVote(ctx, postID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if post.Visibility != "PUBLIC" {
		return nil, nil
	}
	existing, err := s.Q.ExistingVote(ctx, postID, uid)
	has := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	score := int64(post.Score)
	var viewerVote int32
	now := jsontime.New(s.Now())
	switch {
	case value == 0:
		if has {
			if err := s.Q.DeleteVote(ctx, existing.ID); err != nil {
				return nil, err
			}
			score -= int64(existing.Value)
		}
	case !has:
		if err := s.Q.InsertVote(ctx, postID, uid, value); err != nil {
			return nil, err
		}
		score += int64(value)
		viewerVote = value
	case existing.Value != value:
		if err := s.Q.UpdateVote(ctx, value, now, existing.ID); err != nil {
			return nil, err
		}
		score += int64(value - existing.Value)
		viewerVote = value
	default:
		viewerVote = existing.Value
	}
	// score is an integer column: a value beyond int4 failed in Postgres.
	score4, err := db.Int4(score)
	if err != nil {
		return nil, err
	}
	if err := s.Q.SetPostScore(ctx, score4, now, postID); err != nil {
		return nil, err
	}
	s.Log.Info("Community post voted", "postId", postID, "userId", uid, "value", value)
	return httpx.O("score", score4, "viewerVote", viewerVote), nil
}

// CommentInput is CreateCommunityCommentInput.
type CommentInput struct {
	PostID          string
	ParentCommentID *string
	Body            string
	IsAnonymous     bool
}

// CreateComment is createComment; nil when the post is not public.
func (s *Service) CreateComment(ctx context.Context, uid string, in CommentInput) (*httpx.Object, error) {
	post, err := s.PostWithComments(ctx, "", in.PostID)
	if err != nil || post == nil {
		return nil, err
	}
	c, err := s.Q.InsertComment(ctx, q.InsertCommentParams{PostID: in.PostID, AuthorID: uid,
		ParentCommentID: in.ParentCommentID, Body: in.Body, IsAnonymous: in.IsAnonymous})
	if err != nil {
		return nil, err
	}
	s.Log.Info("Community comment created", "postId", in.PostID, "authorId", uid, "parentCommentId", in.ParentCommentID)
	user, err := s.Q.GetUser(ctx, uid)
	var a *Author
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return nil, err
	default:
		// A full user row has no doctorSpecialty, so it is always null here.
		a = &Author{DisplayName: user.DisplayName, CommunityHandle: user.CommunityHandle, Role: user.Role}
	}
	return httpx.O("id", c.ID, "postId", c.PostID, "parentCommentId", c.ParentCommentID, "body", c.Body,
		"createdAt", jsontime.Format(c.CreatedAt.Time), "author", AuthorPublic(a, c.IsAnonymous)), nil
}

// ReportInput is CreateCommunityReportInput.
type ReportInput struct {
	PostID, CommentID, Details *string
	Reason                     string
}

// CreateReport is createReport.
func (s *Service) CreateReport(ctx context.Context, uid string, in ReportInput) error {
	if err := s.Q.InsertReport(ctx, q.InsertReportParams{PostID: in.PostID, CommentID: in.CommentID, ReporterID: uid,
		Reason: in.Reason, Details: in.Details}); err != nil {
		return err
	}
	s.Log.Info("Community report created", "reporterId", uid, "postId", in.PostID, "commentId", in.CommentID)
	return nil
}
