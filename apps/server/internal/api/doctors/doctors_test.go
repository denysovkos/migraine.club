package doctors_test

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/denysovkos/migraine.club/internal/api/doctors"
	"github.com/denysovkos/migraine.club/internal/apitest"
	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/service/doctorverify"
)

const boundary = "testboundary0123456789abcdefghij"

func newEnv(t *testing.T, storage string) *apitest.Env {
	e := apitest.New(t, func(d *app.Deps) http.Handler {
		d.Cfg.FilesStoragePath = storage
		r := chi.NewRouter()
		doctors.Mount(r, d)
		return r
	})
	e.Exec(`INSERT INTO "user" (id, role) VALUES ('u1', 'user'), ('u2', 'user'), ('adm', 'admin')`)
	return e
}

func uploadBody(filename, typ, data string) string {
	return "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\nContent-Type: " + typ +
		"\r\n\r\n" + data + "\r\n--" + boundary + "--\r\n"
}

func upload(e *apitest.Env, user, body string) apitest.Response {
	return e.Do(apitest.Request{Method: "POST", Path: "/api/doctor-verification/upload", User: user, Raw: body,
		Headers: map[string]string{"Content-Type": "multipart/form-data; boundary=" + boundary}})
}

func TestSafeFilename(t *testing.T) {
	require.Equal(t, "a_b_c.pdf", doctorverify.SafeFilename("a/b\\c\x07.pdf"))
	require.Equal(t, "document", doctorverify.SafeFilename("\x01\x02"))
	long := doctorverify.SafeFilename(repeat("é", 300))
	require.Equal(t, 200, len([]rune(long)))
	astral := doctorverify.SafeFilename(repeat("a", 199) + "😀😀")
	require.Equal(t, repeat("a", 199)+"😀", astral, "the length check runs after each character")
}

func repeat(s string, n int) string { return strings.Repeat(s, n) }

func TestApplicationFlowAndOwnership(t *testing.T) {
	dir := t.TempDir()
	e := newEnv(t, dir)
	require.Equal(t, 401, e.Do(apitest.Request{Path: "/api/doctor-verification/application"}).Status)
	require.Equal(t, `{"application":null}`, string(e.Do(apitest.Request{Path: "/api/doctor-verification/application", User: "u1"}).Body))
	require.Equal(t, 400, upload(e, "u1", uploadBody("a.pdf", "application/pdf", "x")).Status)

	res := e.Do(apitest.Request{Method: "PUT", Path: "/api/doctor-verification/application", User: "u1",
		Body: map[string]any{"fullName": "Dr One", "verificationMethod": "document_upload"}})
	require.Equal(t, 200, res.Status)
	app := res.Map(t)["application"].(map[string]any)
	require.Equal(t, "other", app["specialty"])
	require.Equal(t, "", app["country"])

	require.Equal(t, 415, upload(e, "u1", uploadBody("a.gif", "image/gif", "GIF")).Status)
	require.Equal(t, 413, upload(e, "u1", uploadBody("a.pdf", "application/pdf", repeat("x", 1024*1024+1))).Status)
	res = upload(e, "u1", uploadBody("first.pdf", "application/pdf", "%PDF-1"))
	require.Equal(t, 200, res.Status)
	first := res.Map(t)["file"].(map[string]any)
	res = upload(e, "u1", uploadBody("second.pdf", "application/pdf", "%PDF-2"))
	second := res.Map(t)["file"].(map[string]any)
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM doctor_verification_file`), "an upload replaces the old file")
	files, _ := filepath.Glob(filepath.Join(dir, "doctor-verification", "*", "*"))
	require.Len(t, files, 1)

	require.Equal(t, 404, e.Do(apitest.Request{Path: "/api/doctor-verification/files/" + first["id"].(string), User: "u1"}).Status)
	res = e.Do(apitest.Request{Path: "/api/doctor-verification/files/" + second["id"].(string), User: "u1"})
	require.Equal(t, "%PDF-2", string(res.Body))
	require.Equal(t, `attachment; filename="second.pdf"`, res.Header.Get("Content-Disposition"))
	require.Equal(t, 403, e.Do(apitest.Request{Path: "/api/doctor-verification/files/" + second["id"].(string), User: "u2"}).Status)
	require.Equal(t, 403, e.Do(apitest.Request{Path: "/api/admin/doctor-verification/files/" + second["id"].(string), User: "u1"}).Status)
	require.Equal(t, 200, e.Do(apitest.Request{Path: "/api/admin/doctor-verification/files/" + second["id"].(string), User: "adm"}).Status)

	res = e.Do(apitest.Request{Method: "POST", Path: "/api/doctor-verification/application", User: "u1",
		Body: map[string]any{"fullName": "Dr One", "country": "DE", "specialty": "gp", "verificationMethod": "document_upload", "applicantStatementAccepted": true}})
	require.Equal(t, 200, res.Status)
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM "user" WHERE id = 'u1' AND role = 'doctor_pending' AND is_doctor`))
	id := res.Map(t)["application"].(map[string]any)["id"].(string)

	require.Equal(t, 403, e.Do(apitest.Request{Method: "POST", Path: "/api/admin/doctor-verification/applications/" + id + "/approve", User: "u1"}).Status)
	res = e.Do(apitest.Request{Path: "/api/admin/doctor-verification/applications/" + id, User: "adm"})
	detail := res.Map(t)["application"].(map[string]any)
	require.Contains(t, detail, "adminNotes")
	require.NotNil(t, detail["file"])
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/admin/doctor-verification/applications/" + id + "/approve", User: "adm", Raw: "x"})
	require.Equal(t, `{"success":true}`, string(res.Body))
	require.Equal(t, 1, e.Count(`SELECT count(*) FROM "user" WHERE id = 'u1' AND role = 'doctor_verified' AND is_doctor_verified`))

	res = e.Do(apitest.Request{Method: "PUT", Path: "/api/doctor-verification/application", User: "u1", Body: map[string]any{"fullName": "Changed"}})
	require.Equal(t, 409, res.Status)
	require.Equal(t, "APPLICATION_APPROVED_LOCKED", res.Map(t)["code"])
	require.Equal(t, 500, e.Do(apitest.Request{Path: "/api/admin/doctor-verification/applications/abc", User: "adm"}).Status)
}

func TestStorageNotConfigured(t *testing.T) {
	e := newEnv(t, "")
	e.Exec(`INSERT INTO doctor_verification_application (user_id, full_name, country, specialty, verification_method) VALUES ('u1', 'D', 'DE', 'gp', 'document_upload')`)
	res := upload(e, "u1", uploadBody("a.pdf", "application/pdf", "x"))
	require.Equal(t, `{"error":"File storage is not configured.","code":"FILES_STORAGE_PATH_NOT_CONFIGURED"}`, string(res.Body))
}

func TestFeatureRequests(t *testing.T) {
	e := newEnv(t, "")
	for i, title := range []string{"One idea", "Two idea", "Three idea"} {
		res := e.Do(apitest.Request{Method: "POST", Path: "/api/feature-requests", User: "u1", Body: map[string]any{"title": " " + title + " ", "description": "A long enough description"}})
		require.Equal(t, 201, res.Status, i)
		require.Equal(t, title, res.Map(t)["request"].(map[string]any)["title"])
	}
	res := e.Do(apitest.Request{Method: "POST", Path: "/api/feature-requests", User: "u1", Body: map[string]any{"title": "Four", "description": "A long enough description"}})
	require.Equal(t, `{"error":"Active request limit reached","code":"ACTIVE_REQUEST_LIMIT_REACHED","maxActiveRequests":3}`, string(res.Body))
	require.Len(t, e.Do(apitest.Request{Path: "/api/feature-requests", User: "u2"}).Map(t)["requests"], 0)
	require.Equal(t, 403, e.Do(apitest.Request{Path: "/api/admin/feature-requests", User: "u1"}).Status)
	all := e.Do(apitest.Request{Path: "/api/admin/feature-requests", User: "adm"}).Map(t)["requests"].([]any)
	require.Len(t, all, 3)
	id := all[0].(map[string]any)["id"].(string)
	res = e.Do(apitest.Request{Method: "PATCH", Path: "/api/admin/feature-requests", User: "adm", Body: map[string]any{"requestId": id, "resolution": "ACCEPTED"}})
	require.Equal(t, "ACCEPTED", res.Map(t)["request"].(map[string]any)["resolution"])
	res = e.Do(apitest.Request{Method: "POST", Path: "/api/feature-requests", User: "u1", Body: map[string]any{"title": "Four", "description": "A long enough description"}})
	require.Equal(t, 201, res.Status, "an accepted request no longer counts as active")
}
