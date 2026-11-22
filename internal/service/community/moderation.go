package community

import (
	"context"
	"errors"
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// moderationAuthor is ModerationService's mapAuthorPublic: the display name
// is the community handle and the specialty is never shown.
func moderationAuthor(handle *string, role string, found, isAnonymous bool) *httpx.Object {
	if !found || isAnonymous {
		return anonymous()
	}
	var name any
	if handle != nil {
		name = *handle
	}
	return httpx.O("displayName", name, "isDoctor", isDoctorRole(role), "isDoctorVerified", role == "doctor_verified",
		"doctorSpecialty", nil, "isAnonymous", false)
}

// reportAuthorDefault is the contentAuthor used before any content is found;
// it has no doctorSpecialty key.
func reportAuthorDefault() *httpx.Object {
	return httpx.O("displayName", nil, "isDoctor", false, "isDoctorVerified", false, "isAnonymous", true)
}

// snippet is body.slice(0, n) + (body.length > n ? '…' : '').
func snippet(body string, n int) jsx.JSString {
	out := jsx.SliceUTF16(body, 0, n)
	if jsx.Len(body) > n {
		out += "…"
	}
	return jsx.JSString(out)
}

func (s *Service) author(ctx context.Context, uid string, isAnonymous bool) (*httpx.Object, error) {
	u, err := s.Q.GetUser(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return moderationAuthor(nil, "", false, isAnonymous), nil
	}
	if err != nil {
		return nil, err
	}
	return moderationAuthor(u.CommunityHandle, u.Role, true, isAnonymous), nil
}

// OpenReports is getOpenReports.
func (s *Service) OpenReports(ctx context.Context, limit int32) ([]any, error) {
	rows, err := s.Q.OpenReports(ctx, limit)
	if err != nil {
		return nil, err
	}
	out := make([]any, 0, len(rows))
	for _, r := range rows {
		var content any = ""
		contentType := "post"
		author := reportAuthorDefault()
		switch {
		case r.PostID != nil && *r.PostID != "":
			p, err := s.Q.ReportPost(ctx, *r.PostID)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
			case err != nil:
				return nil, err
			default:
				content = jsx.JSString(p.Title+": ") + snippet(p.Body, 100)
				if author, err = s.author(ctx, p.AuthorID, p.IsAnonymous); err != nil {
					return nil, err
				}
			}
		case r.CommentID != nil && *r.CommentID != "":
			c, err := s.Q.ReportComment(ctx, *r.CommentID)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
			case err != nil:
				return nil, err
			default:
				content = snippet(c.Body, 150)
				contentType = "comment"
				if author, err = s.author(ctx, c.AuthorID, c.IsAnonymous); err != nil {
					return nil, err
				}
			}
		}
		out = append(out, httpx.O("id", r.ID, "postId", r.PostID, "commentId", r.CommentID, "reason", r.Reason,
			"details", r.Details, "status", r.Status, "createdAt", jsontime.Format(r.CreatedAt.Time),
			"contentSnippet", content, "contentType", contentType, "contentAuthor", author))
	}
	return out, nil
}

// ResolveReport is resolveReport.
func (s *Service) ResolveReport(ctx context.Context, moderator, reportID, status string) (bool, error) {
	ids, err := s.Q.ResolveReport(ctx, status, &moderator, jsontime.Ptr(s.Now()), reportID)
	if err != nil || len(ids) == 0 {
		return false, err
	}
	s.Log.Info("Report resolved", "reportId", reportID, "moderatorId", moderator, "status", status)
	return true, nil
}

// SetVisibility is updateContentVisibility.
func (s *Service) SetVisibility(ctx context.Context, moderator string, postID, commentID *string, visibility string) (bool, error) {
	now := jsontime.New(s.Now())
	switch {
	case postID != nil && *postID != "":
		ids, err := s.Q.SetPostVisibility(ctx, visibility, now, *postID)
		if err != nil || len(ids) == 0 {
			return false, err
		}
		s.Log.Info("Post visibility updated", "postId", *postID, "moderatorId", moderator, "visibility", visibility)
		return true, nil
	case commentID != nil && *commentID != "":
		ids, err := s.Q.SetCommentVisibility(ctx, visibility, now, *commentID)
		if err != nil || len(ids) == 0 {
			return false, err
		}
		s.Log.Info("Comment visibility updated", "commentId", *commentID, "moderatorId", moderator, "visibility", visibility)
		return true, nil
	}
	return false, nil
}

type hiddenItem struct {
	obj      *httpx.Object
	hiddenAt int64
}

// HiddenContent is getHiddenContent.
func (s *Service) HiddenContent(ctx context.Context, limit int32) ([]any, error) {
	var items []hiddenItem
	posts, err := s.Q.HiddenPosts(ctx, limit)
	if err != nil {
		return nil, err
	}
	for _, p := range posts {
		a, err := s.author(ctx, p.AuthorID, p.IsAnonymous)
		if err != nil {
			return nil, err
		}
		items = append(items, hiddenItem{httpx.O("id", p.ID, "type", "post", "title", p.Title, "bodySnippet", snippet(p.Body, 100),
			"author", a, "hiddenAt", jsontime.Format(p.UpdatedAt.Time)), p.UpdatedAt.UnixMilli()})
	}
	comments, err := s.Q.HiddenComments(ctx, limit)
	if err != nil {
		return nil, err
	}
	for _, c := range comments {
		a, err := s.author(ctx, c.AuthorID, c.IsAnonymous)
		if err != nil {
			return nil, err
		}
		items = append(items, hiddenItem{httpx.O("id", c.ID, "type", "comment", "bodySnippet", snippet(c.Body, 150),
			"author", a, "hiddenAt", jsontime.Format(c.UpdatedAt.Time), "postId", c.PostID), c.UpdatedAt.UnixMilli()})
	}
	// A consistent numeric comparator: any stable sort matches V8.
	sort.SliceStable(items, func(i, j int) bool { return items[i].hiddenAt > items[j].hiddenAt })
	out := []any{}
	for i, it := range items {
		if i >= int(limit) {
			break
		}
		out = append(out, it.obj)
	}
	return out, nil
}

// SetRole is updateUserRole.
func (s *Service) SetRole(ctx context.Context, admin, uid, role string) (bool, error) {
	ids, err := s.Q.SetUserRole(ctx, role, jsontime.New(s.Now()), uid)
	if err != nil || len(ids) == 0 {
		return false, err
	}
	s.Log.Info("User role updated", "userId", uid, "adminId", admin, "newRole", role)
	return true, nil
}

// Users is getUsers.
func (s *Service) Users(ctx context.Context, search string, limit int32) ([]any, error) {
	out := []any{}
	add := func(id string, handle *string, role string, isDoctor, verified bool, created jsontime.Time) {
		out = append(out, httpx.O("id", id, "communityHandle", handle, "role", role, "isDoctor", isDoctor,
			"isDoctorVerified", verified, "createdAt", jsontime.Format(created.Time)))
	}
	if search != "" {
		pattern := "%" + search + "%"
		rows, err := s.Q.ModerationUsersSearch(ctx, &pattern, limit)
		if err != nil {
			return nil, err
		}
		for _, u := range rows {
			add(u.ID, u.CommunityHandle, u.Role, u.IsDoctor, u.IsDoctorVerified, u.CreatedAt)
		}
		return out, nil
	}
	rows, err := s.Q.ModerationUsers(ctx, limit)
	if err != nil {
		return nil, err
	}
	for _, u := range rows {
		add(u.ID, u.CommunityHandle, u.Role, u.IsDoctor, u.IsDoctorVerified, u.CreatedAt)
	}
	return out, nil
}
