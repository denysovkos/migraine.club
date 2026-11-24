package community_test

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/community"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
)

func newEnv(t *testing.T) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		r := chi.NewRouter()
		community.Mount(r, d)
		return r
	})
	e.Exec(`INSERT INTO "user" (id, role) VALUES ('u1', 'user'), ('mod', 'moderator'), ('adm', 'admin')`)
	return e
}

func TestAuthAndRoleGuards(t *testing.T) {
	e := newEnv(t)
	routes := [][2]string{{"GET", "/api/community/posts"}, {"POST", "/api/community/posts"}, {"GET", "/api/community/posts/x"},
		{"POST", "/api/community/posts/x/vote"}, {"POST", "/api/community/comments"}, {"POST", "/api/community/report"},
		{"GET", "/api/community/stats"}, {"GET", "/api/moderation/role"}, {"GET", "/api/moderation/reports"},
		{"POST", "/api/moderation/reports"}, {"GET", "/api/moderation/visibility"}, {"POST", "/api/moderation/visibility"},
		{"GET", "/api/moderation/users"}, {"POST", "/api/moderation/users"}}
	for _, rt := range routes {
		require.Equal(t, 401, e.Do(apitest.Request{Method: rt[0], Path: rt[1], Body: map[string]any{}}).Status, rt[1])
	}
	for _, rt := range [][2]string{{"GET", "/api/moderation/reports"}, {"POST", "/api/moderation/visibility"}, {"GET", "/api/moderation/users"}} {
		res := e.Do(apitest.Request{Method: rt[0], Path: rt[1], User: "u1", Body: map[string]any{}})
		require.Equal(t, `{"error":"Forbidden"}`, string(res.Body), rt[1])
	}
	require.Equal(t, 403, e.Do(apitest.Request{Path: "/api/moderation/users", User: "mod"}).Status)
	require.Equal(t, 200, e.Do(apitest.Request{Path: "/api/moderation/users", User: "adm"}).Status)
	require.Equal(t, `{"role":"moderator","isModerator":true,"isAdmin":false}`, string(e.Do(apitest.Request{Path: "/api/moderation/role", User: "mod"}).Body))
	require.Equal(t, `{"role":"user","isModerator":false,"isAdmin":false}`, string(e.Do(apitest.Request{Path: "/api/moderation/role", User: "ghost"}).Body))
}

func TestValidationShapes(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Path: "/api/community/posts?limit=51&sort=x", User: "u1"})
	require.Equal(t, 400, res.Status)
	require.JSONEq(t, `{"error":"Invalid query parameters","details":{"formErrors":[],"fieldErrors":{
		"limit":["Too big: expected number to be <=50"],"sort":["Invalid option: expected one of \"new\"|\"top\""]}}}`, string(res.Body))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/community/posts", User: "u1", Body: map[string]any{"title": "ok title", "body": "b", "tags": []any{"", "", "", "", "", "", "", "", ""}}})
	require.JSONEq(t, `{"error":"Validation error","details":{"formErrors":[],"fieldErrors":{"tags":["Too big: expected array to have <=8 items"]}}}`, string(res.Body))

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/community/report", User: "u1", Body: map[string]any{"reason": "spam"}})
	require.JSONEq(t, `{"error":"Validation error","details":{"formErrors":[],"fieldErrors":{"postId":["Either postId or commentId must be provided (but not both)"]}}}`, string(res.Body))

	require.Equal(t, 500, e.Do(apitest.Request{Method: "POST", Path: "/api/community/comments", User: "u1", Raw: "{"}).Status)
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/moderation/users", User: "adm", Body: map[string]any{"userId": "adm", "role": "user"}})
	require.Equal(t, `{"error":"Cannot remove your own admin role"}`, string(res.Body))
}

func TestPostLifecycle(t *testing.T) {
	e := newEnv(t)
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/community/posts", User: "u1", Body: map[string]any{"title": "Hello", "body": "World"}})
	require.Equal(t, 201, res.Status)
	id := res.Map(t)["id"].(string)
	require.Equal(t, true, res.Map(t)["author"].(map[string]any)["isAnonymous"])

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/community/posts/" + id + "/vote", User: "mod", Body: map[string]any{"value": 1}})
	require.Equal(t, `{"score":1,"viewerVote":1}`, string(res.Body))
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/community/comments", User: "mod", Body: map[string]any{"postId": id, "body": "Hi"}})
	require.Equal(t, 201, res.Status)

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/moderation/visibility", User: "mod", Body: map[string]any{"postId": id, "visibility": "HIDDEN"}})
	require.Equal(t, `{"success":true}`, string(res.Body))
	require.Equal(t, 404, e.Do(apitest.Request{Path: "/api/community/posts/" + id, User: "u1"}).Status)
	require.Equal(t, 200, e.Do(apitest.Request{Path: "/api/community/posts/" + id, User: "mod"}).Status)
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/community/comments", User: "u1", Body: map[string]any{"postId": id, "body": "x"}})
	require.Equal(t, `{"error":"Post not found"}`, string(res.Body))
}
