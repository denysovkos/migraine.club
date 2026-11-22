// Package community serves /api/community/* and /api/moderation/*.
package community

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsx"
	svc "github.com/denysovkos/migraine.club/internal/service/community"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var (
	createPostSchema = zod.Object(
		zod.F("title", zod.String().Min(3).Max(140)),
		zod.F("body", zod.String().Min(1).Max(8000)),
		zod.F("isAnonymous", zod.Default(zod.Boolean(), true)),
		zod.F("tags", zod.Optional(zod.Array(zod.String().Min(1).Max(32)).Max(8))),
		zod.F("episodeId", zod.Optional(zod.Number().Int().Positive())),
	)
	listSchema = zod.Object(
		zod.F("page", zod.Default(zod.Number().Int().Min(1), 1.0)),
		zod.F("limit", zod.Default(zod.Number().Int().Min(1).Max(50), 10.0)),
		zod.F("sort", zod.Default(zod.Enum("new", "top"), "new")),
		zod.F("tag", zod.Optional(zod.String().Max(32))),
		zod.F("onlyOwn", zod.Default(zod.Boolean(), false)),
	)
	voteSchema    = zod.Object(zod.F("value", zod.Union(zod.Literal(-1.0), zod.Literal(0.0), zod.Literal(1.0))))
	commentSchema = zod.Object(
		zod.F("postId", zod.String().GUID()),
		zod.F("parentCommentId", zod.Optional(zod.String().GUID())),
		zod.F("body", zod.String().Min(1).Max(4000)),
		zod.F("isAnonymous", zod.Default(zod.Boolean(), true)),
	)
	reportSchema = exactlyOne(zod.Object(
		zod.F("postId", zod.Optional(zod.String().GUID())),
		zod.F("commentId", zod.Optional(zod.String().GUID())),
		zod.F("reason", zod.Enum("spam", "abuse", "misinformation", "other")),
		zod.F("details", zod.Optional(zod.String().Max(2000))),
	))
	visibilitySchema = exactlyOne(zod.Object(
		zod.F("postId", zod.Optional(zod.String().GUID())),
		zod.F("commentId", zod.Optional(zod.String().GUID())),
		zod.F("visibility", zod.Enum("PUBLIC", "HIDDEN")),
	))
	resolveSchema = zod.Object(
		zod.F("reportId", zod.String().GUID()),
		zod.F("status", zod.Enum("RESOLVED", "DISMISSED")),
	)
	roleSchema = zod.Object(
		zod.F("userId", zod.String()),
		zod.F("role", zod.Enum("user", "moderator", "admin")),
	)
)

// exactlyOne is the `.refine` both report and visibility schemas carry.
func exactlyOne(s zod.Schema) zod.Schema {
	return zod.Refine(s, func(v any) bool {
		m, _ := v.(map[string]any)
		post, comment := nonEmpty(m["postId"]), nonEmpty(m["commentId"])
		return post != comment
	}, "Either postId or commentId must be provided (but not both)", "postId")
}

func nonEmpty(v any) bool { s, ok := v.(string); return ok && s != "" }

func str(m map[string]any, k string) *string {
	if s, ok := m[k].(string); ok {
		return &s
	}
	return nil
}

type handlers struct {
	d   *app.Deps
	svc *svc.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d, svc: &svc.Service{Q: d.Q, Log: d.Log, Now: d.Clock}}
	r.Get("/api/community/posts", h.listPosts)
	r.Post("/api/community/posts", h.createPost)
	r.Get("/api/community/posts/{id}", h.getPost)
	r.Post("/api/community/posts/{id}/vote", h.vote)
	r.Post("/api/community/comments", h.createComment)
	r.Post("/api/community/report", h.report)
	r.Get("/api/community/stats", h.stats)

	r.Get("/api/moderation/role", h.role)
	r.Get("/api/moderation/reports", h.moderator(h.openReports))
	r.Post("/api/moderation/reports", h.moderator(h.resolveReport))
	r.Get("/api/moderation/visibility", h.moderator(h.hidden))
	r.Post("/api/moderation/visibility", h.moderator(h.setVisibility))
	r.Get("/api/moderation/users", h.admin(h.users))
	r.Post("/api/moderation/users", h.admin(h.setRole))
}

func (h handlers) internal(w http.ResponseWriter, msg string, err error) {
	h.d.Log.Error(msg, "error", err)
	httpx.Error(w, http.StatusInternalServerError, "Internal server error")
}

func validation(w http.ResponseWriter, err error) bool {
	var zerr *zod.Error
	if errors.As(err, &zerr) {
		httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Validation error", "details", zerr.Flatten()))
		return true
	}
	return false
}

// parse reads the body and validates it; it answers the request itself
// unless ok. A malformed body was a 500: request.json() threw.
func (h handlers) parse(w http.ResponseWriter, r *http.Request, s zod.Schema, msg string) (map[string]any, bool) {
	body, err := httpx.ReadJSON(r)
	if err != nil {
		h.internal(w, msg, err)
		return nil, false
	}
	v, err := zod.Parse(s, body)
	if err != nil {
		if !validation(w, err) {
			h.internal(w, msg, err)
		}
		return nil, false
	}
	return v.(map[string]any), true
}

func (h handlers) listPosts(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	qp := r.URL.Query()
	raw := map[string]any{}
	for _, k := range []string{"page", "limit"} {
		if v := qp.Get(k); v != "" {
			raw[k] = jsx.ParseIntNumber(v)
		}
	}
	if v, ok := qp["sort"]; ok {
		raw["sort"] = v[0]
	}
	if v, ok := qp["tag"]; ok {
		raw["tag"] = v[0]
	}
	raw["onlyOwn"] = qp.Get("onlyOwn") != ""
	parsed, err := zod.Parse(listSchema, raw)
	if err != nil {
		var zerr *zod.Error
		if errors.As(err, &zerr) {
			h.d.Log.Warn("Validation error listing community posts")
			httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Invalid query parameters", "details", zerr.Flatten()))
			return
		}
		h.internal(w, "Error listing community posts", err)
		return
	}
	m := parsed.(map[string]any)
	tag, _ := m["tag"].(string)
	posts, err := h.svc.ListPosts(r.Context(), uid, svc.ListQuery{Page: m["page"].(float64), Limit: m["limit"].(float64),
		Sort: m["sort"].(string), Tag: tag, OnlyOwn: m["onlyOwn"].(bool)})
	if err != nil {
		h.internal(w, "Error listing community posts", err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("posts", posts))
}

func (h handlers) createPost(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	m, ok := h.parse(w, r, createPostSchema, "Unexpected error creating community post")
	if !ok {
		return
	}
	in := svc.PostInput{Title: m["title"].(string), Body: m["body"].(string), IsAnonymous: m["isAnonymous"].(bool)}
	if tags, ok := m["tags"].([]any); ok {
		for _, t := range tags {
			in.Tags = append(in.Tags, t.(string))
		}
	}
	if id, ok := m["episodeId"].(float64); ok {
		// A positive integer beyond int4 failed in the ownership query.
		if id > 2147483647 {
			h.internal(w, "Error creating community post", errors.New("episode id out of range"))
			return
		}
		e := int32(id)
		in.EpisodeID = &e
	}
	post, err := h.svc.CreatePost(r.Context(), uid, in)
	if errors.Is(err, svc.ErrEpisodeForbidden) {
		httpx.Error(w, http.StatusForbidden, "Episode not found or access denied")
		return
	}
	if err != nil {
		h.internal(w, "Error creating community post", err)
		return
	}
	httpx.JSON(w, http.StatusCreated, post)
}

func (h handlers) getPost(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	post, err := h.svc.PostWithComments(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil {
		h.internal(w, "Error fetching community post", err)
		return
	}
	if post == nil {
		httpx.Error(w, http.StatusNotFound, "Post not found")
		return
	}
	httpx.JSON(w, http.StatusOK, post)
}

func (h handlers) vote(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	m, ok := h.parse(w, r, voteSchema, "Error voting on community post")
	if !ok {
		return
	}
	res, err := h.svc.Vote(r.Context(), uid, chi.URLParam(r, "id"), int32(m["value"].(float64)))
	if err != nil {
		h.internal(w, "Error voting on community post", err)
		return
	}
	if res == nil {
		httpx.Error(w, http.StatusNotFound, "Post not found")
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

func (h handlers) createComment(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	m, ok := h.parse(w, r, commentSchema, "Error creating community comment")
	if !ok {
		return
	}
	c, err := h.svc.CreateComment(r.Context(), uid, svc.CommentInput{PostID: m["postId"].(string),
		ParentCommentID: str(m, "parentCommentId"), Body: m["body"].(string), IsAnonymous: m["isAnonymous"].(bool)})
	if err != nil {
		h.internal(w, "Error creating community comment", err)
		return
	}
	if c == nil {
		httpx.Error(w, http.StatusNotFound, "Post not found")
		return
	}
	httpx.JSON(w, http.StatusCreated, c)
}

func (h handlers) report(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	m, ok := h.parse(w, r, reportSchema, "Error creating community report")
	if !ok {
		return
	}
	if err := h.svc.CreateReport(r.Context(), uid, svc.ReportInput{PostID: str(m, "postId"), CommentID: str(m, "commentId"),
		Reason: m["reason"].(string), Details: str(m, "details")}); err != nil {
		h.internal(w, "Error creating community report", err)
		return
	}
	httpx.JSON(w, http.StatusCreated, httpx.O("success", true))
}

func (h handlers) stats(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	res, err := h.svc.Stats(r.Context(), h.d.Clock().In(time.Local))
	if err != nil {
		h.internal(w, "Error fetching community stats", err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

// moderator wraps a handler that needs the moderator or admin role.
func (h handlers) moderator(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return h.guard(next, h.svc.IsModerator)
}

// admin wraps a handler that needs the admin role.
func (h handlers) admin(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return h.guard(next, h.svc.IsAdmin)
}

func (h handlers) guard(next func(http.ResponseWriter, *http.Request, string),
	allowed func(ctx context.Context, uid string) (bool, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := auth.UserID(r.Context())
		if uid == "" {
			httpx.Unauthorized(w)
			return
		}
		ok, err := allowed(r.Context(), uid)
		if err != nil {
			h.internal(w, "Error checking moderation role", err)
			return
		}
		if !ok {
			httpx.Error(w, http.StatusForbidden, "Forbidden")
			return
		}
		next(w, r, uid)
	}
}

func (h handlers) role(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.Unauthorized(w)
		return
	}
	role, err := h.svc.UserRole(r.Context(), uid)
	if err != nil {
		h.internal(w, "Error fetching user role", err)
		return
	}
	shown := role
	if shown == "" {
		shown = "user"
	}
	httpx.JSON(w, http.StatusOK, httpx.O("role", shown, "isModerator", role == "moderator" || role == "admin", "isAdmin", role == "admin"))
}

func (h handlers) openReports(w http.ResponseWriter, r *http.Request, _ string) {
	reports, err := h.svc.OpenReports(r.Context(), 50)
	if err != nil {
		h.internal(w, "Error fetching moderation reports", err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("reports", reports))
}

func (h handlers) resolveReport(w http.ResponseWriter, r *http.Request, uid string) {
	m, ok := h.parse(w, r, resolveSchema, "Error resolving report")
	if !ok {
		return
	}
	done, err := h.svc.ResolveReport(r.Context(), uid, m["reportId"].(string), m["status"].(string))
	if err != nil {
		h.internal(w, "Error resolving report", err)
		return
	}
	if !done {
		httpx.Error(w, http.StatusNotFound, "Report not found")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("success", true))
}

func (h handlers) hidden(w http.ResponseWriter, r *http.Request, _ string) {
	items, err := h.svc.HiddenContent(r.Context(), 50)
	if err != nil {
		h.internal(w, "Error fetching hidden content", err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("items", items))
}

func (h handlers) setVisibility(w http.ResponseWriter, r *http.Request, uid string) {
	m, ok := h.parse(w, r, visibilitySchema, "Error updating content visibility")
	if !ok {
		return
	}
	done, err := h.svc.SetVisibility(r.Context(), uid, str(m, "postId"), str(m, "commentId"), m["visibility"].(string))
	if err != nil {
		h.internal(w, "Error updating content visibility", err)
		return
	}
	if !done {
		httpx.Error(w, http.StatusNotFound, "Content not found")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("success", true))
}

func (h handlers) users(w http.ResponseWriter, r *http.Request, _ string) {
	search := ""
	if v, ok := r.URL.Query()["search"]; ok {
		search = v[0]
	}
	users, err := h.svc.Users(r.Context(), search, 50)
	if err != nil {
		h.internal(w, "Error fetching users for moderation", err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("users", users))
}

func (h handlers) setRole(w http.ResponseWriter, r *http.Request, uid string) {
	m, ok := h.parse(w, r, roleSchema, "Error updating user role")
	if !ok {
		return
	}
	target, role := m["userId"].(string), m["role"].(string)
	if target == uid && role != "admin" {
		httpx.Error(w, http.StatusBadRequest, "Cannot remove your own admin role")
		return
	}
	done, err := h.svc.SetRole(r.Context(), uid, target, role)
	if err != nil {
		h.internal(w, "Error updating user role", err)
		return
	}
	if !done {
		httpx.Error(w, http.StatusNotFound, "User not found")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("success", true))
}
