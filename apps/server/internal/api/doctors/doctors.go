// Package doctors serves /api/doctor-verification/*, the admin review under
// /api/admin/doctor-verification/* and the feature requests (/api/feature-requests,
// /api/admin/feature-requests).
package doctors

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/app"
	"github.com/denysovkos/migraine.club/internal/auth"
	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
	"github.com/denysovkos/migraine.club/internal/service/community"
	"github.com/denysovkos/migraine.club/internal/service/doctorverify"
	"github.com/denysovkos/migraine.club/internal/zod"
)

var (
	specialty = zod.Enum("neurologist", "gp", "pain_specialist", "other")
	method    = zod.Enum("license_number", "clinic_email", "document_upload")
	license   = zod.Optional(zod.Nullable(zod.String().Min(2).Max(128)))
	email     = zod.Optional(zod.Nullable(zod.String().Email().Max(254)))

	draftSchema = zod.Object(
		zod.F("fullName", zod.Optional(zod.String().Min(2).Max(200))),
		zod.F("country", zod.Optional(zod.String().Min(2).Max(64))),
		zod.F("specialty", zod.Optional(specialty)),
		zod.F("verificationMethod", zod.Optional(method)),
		zod.F("applicantStatementAccepted", zod.Optional(zod.Boolean())),
		zod.F("licenseNumber", zod.Optional(license)),
		zod.F("clinicEmail", zod.Optional(email)),
	)
	submitSchema = zod.SuperRefine(zod.Object(
		zod.F("fullName", zod.String().Min(2).Max(200)),
		zod.F("country", zod.String().Min(2).Max(64)),
		zod.F("specialty", specialty),
		zod.F("verificationMethod", method),
		zod.F("applicantStatementAccepted", zod.Boolean()),
		zod.F("licenseNumber", license),
		zod.F("clinicEmail", email),
		zod.F("reapply", zod.Default(zod.Optional(zod.Boolean()), false)),
	), func(v any, ctx *zod.Ctx) {
		m := v.(map[string]any)
		if m["applicantStatementAccepted"] != true {
			ctx.Issue("code", "custom", "path", []any{"applicantStatementAccepted"}, "message", "You must accept the statement to submit.")
		}
		trimmedLen := func(k string) int {
			s, _ := m[k].(string)
			return len(trimJS(s))
		}
		if m["verificationMethod"] == "license_number" && trimmedLen("licenseNumber") < 2 {
			ctx.Issue("code", "custom", "path", []any{"licenseNumber"}, "message", "License number is required for this verification method.")
		}
		if m["verificationMethod"] == "clinic_email" && trimmedLen("clinicEmail") < 3 {
			ctx.Issue("code", "custom", "path", []any{"clinicEmail"}, "message", "Clinic email is required for this verification method.")
		}
	})
	approveSchema = zod.Object(
		zod.F("adminNotes", zod.Optional(zod.Nullable(zod.String().Max(4000)))),
		zod.F("userFacingNote", zod.Optional(zod.Nullable(zod.String().Max(4000)))),
	)
	rejectSchema = zod.Object(
		zod.F("reason", zod.String().Min(2).Max(1000)),
		zod.F("adminNotes", zod.Optional(zod.Nullable(zod.String().Max(4000)))),
		zod.F("userFacingNote", zod.Optional(zod.Nullable(zod.String().Max(4000)))),
	)
	featureSchema = zod.Object(
		zod.F("title", zod.String().Trim().Min(3).Max(140)),
		zod.F("description", zod.String().Trim().Min(10).Max(4000)),
	)
	resolutionSchema = zod.Object(
		zod.F("requestId", zod.String().GUID()),
		zod.F("resolution", zod.Union(zod.Literal("SENT"), zod.Literal("IN REVIEW"), zod.Literal("ACCEPTED"), zod.Literal("REJECTED"))),
	)
)

type handlers struct {
	d     *app.Deps
	svc   *doctorverify.Service
	roles *community.Service
}

// Mount registers the routes.
func Mount(r chi.Router, d *app.Deps) {
	h := handlers{d: d,
		svc:   &doctorverify.Service{Q: d.Q, Log: d.Log, Now: d.Clock, StoragePath: d.Cfg.FilesStoragePath},
		roles: &community.Service{Q: d.Q, Log: d.Log, Now: d.Clock}}
	r.Get("/api/doctor-verification/application", h.user(h.getApplication))
	r.Put("/api/doctor-verification/application", h.user(h.saveDraft))
	r.Post("/api/doctor-verification/application", h.user(h.submit))
	r.Post("/api/doctor-verification/upload", h.user(h.upload))
	r.Get("/api/doctor-verification/files/{fileId}", h.user(h.ownFile))

	r.Get("/api/admin/doctor-verification/applications", h.admin(h.listApplications))
	r.Get("/api/admin/doctor-verification/applications/{id}", h.admin(h.applicationDetail))
	r.Post("/api/admin/doctor-verification/applications/{id}/approve", h.admin(h.approve))
	r.Post("/api/admin/doctor-verification/applications/{id}/reject", h.admin(h.reject))
	r.Get("/api/admin/doctor-verification/files/{fileId}", h.admin(h.adminFile))

	r.Get("/api/feature-requests", h.user(h.ownFeatureRequests))
	r.Post("/api/feature-requests", h.user(h.createFeatureRequest))
	r.Get("/api/admin/feature-requests", h.admin(h.allFeatureRequests))
	r.Patch("/api/admin/feature-requests", h.admin(h.setResolution))
}

func (h handlers) unhandled(w http.ResponseWriter, err error) {
	h.d.Log.Error("Unhandled route error", "error", err)
	httpx.Unhandled(w)
}

func (h handlers) user(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := auth.UserID(r.Context())
		if uid == "" {
			httpx.Unauthorized(w)
			return
		}
		next(w, r, uid)
	}
}

// admin has no try/catch around the role lookup in any of these routes.
func (h handlers) admin(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return h.user(func(w http.ResponseWriter, r *http.Request, uid string) {
		ok, err := h.roles.IsAdmin(r.Context(), uid)
		if err != nil {
			h.unhandled(w, err)
			return
		}
		if !ok {
			httpx.Error(w, http.StatusForbidden, "Forbidden")
			return
		}
		next(w, r, uid)
	})
}

func validation(w http.ResponseWriter, err error) {
	var zerr *zod.Error
	if errors.As(err, &zerr) {
		httpx.JSON(w, http.StatusBadRequest, httpx.O("error", "Validation error", "details", zerr.Flatten()))
	}
}

// parse is `await request.json()` (a malformed body throws) or, with lenient,
// `request.json().catch(() => ({}))`, then safeParse.
func (h handlers) parse(w http.ResponseWriter, r *http.Request, s zod.Schema, lenient bool) (map[string]any, bool) {
	var body any
	if lenient {
		body = httpx.ReadJSONOr(r, map[string]any{})
	} else {
		var err error
		if body, err = httpx.ReadJSON(r); err != nil {
			h.unhandled(w, err)
			return nil, false
		}
	}
	v, err := zod.Parse(s, body)
	if err != nil {
		validation(w, err)
		return nil, false
	}
	return v.(map[string]any), true
}

func codeError(w http.ResponseWriter, status int, msg, code string) {
	httpx.JSON(w, status, httpx.O("error", msg, "code", code))
}

func (h handlers) getApplication(w http.ResponseWriter, r *http.Request, uid string) {
	a, err := h.svc.Latest(r.Context(), uid)
	if err != nil {
		h.unhandled(w, err)
		return
	}
	var dto any
	if a != nil {
		dto = a.DTO()
	}
	httpx.JSON(w, http.StatusOK, httpx.O("application", dto))
}

func strPtr(v any) *string {
	if s, ok := v.(string); ok {
		return &s
	}
	return nil
}

func (h handlers) saveDraft(w http.ResponseWriter, r *http.Request, uid string) {
	reapply := r.URL.Query().Get("reapply") == "true"
	m, ok := h.parse(w, r, draftSchema, false)
	if !ok {
		return
	}
	var d doctorverify.Draft
	if v, ok := m["fullName"].(string); ok {
		d.FullName, d.SetFullName = v, true
	}
	if v, ok := m["country"].(string); ok {
		d.Country, d.SetCountry = v, true
	}
	if v, ok := m["specialty"].(string); ok {
		d.Specialty, d.SetSpecialty = v, true
	}
	if v, ok := m["verificationMethod"].(string); ok {
		d.VerificationMethod, d.SetMethod = v, true
	}
	if v, ok := m["licenseNumber"]; ok {
		d.LicenseNumber, d.SetLicense = strPtr(v), true
	}
	if v, ok := m["clinicEmail"]; ok {
		d.ClinicEmail, d.SetEmail = strPtr(v), true
	}
	if v, ok := m["applicantStatementAccepted"].(bool); ok {
		d.ApplicantStatementAccepted, d.SetStatement = v, true
	}
	a, err := h.svc.SaveDraft(r.Context(), uid, d, reapply)
	switch {
	case errors.Is(err, doctorverify.ErrApprovedLocked):
		codeError(w, http.StatusConflict, "Application already approved", "APPLICATION_APPROVED_LOCKED")
	case errors.Is(err, doctorverify.ErrRejectedLocked):
		codeError(w, http.StatusConflict, "Application rejected. Please re-apply.", "APPLICATION_REJECTED_LOCKED")
	case err != nil:
		h.d.Log.Error("Failed to save draft", "error", err)
		httpx.Error(w, http.StatusInternalServerError, "Failed to save draft")
	default:
		httpx.JSON(w, http.StatusOK, httpx.O("application", a.DTO()))
	}
}

func (h handlers) submit(w http.ResponseWriter, r *http.Request, uid string) {
	m, ok := h.parse(w, r, submitSchema, false)
	if !ok {
		return
	}
	reapply := m["reapply"] == true
	fail := func(err error) {
		switch {
		case errors.Is(err, doctorverify.ErrApprovedLocked):
			codeError(w, http.StatusConflict, "Application already approved", "APPLICATION_APPROVED_LOCKED")
		case errors.Is(err, doctorverify.ErrRejectedLocked):
			codeError(w, http.StatusConflict, "Rejected application. Please re-apply.", "REAPPLY_REQUIRED")
		default:
			h.d.Log.Error("Failed to submit application", "error", err)
			httpx.Error(w, http.StatusInternalServerError, "Failed to submit application")
		}
	}
	latest, err := h.svc.Latest(r.Context(), uid)
	if err != nil {
		fail(err)
		return
	}
	if latest != nil && latest.Status == "rejected" && !reapply {
		codeError(w, http.StatusConflict, "Rejected application. Please re-apply.", "REAPPLY_REQUIRED")
		return
	}
	a, err := h.svc.SaveDraft(r.Context(), uid, doctorverify.Draft{
		FullName: m["fullName"].(string), Country: m["country"].(string), Specialty: m["specialty"].(string),
		VerificationMethod: m["verificationMethod"].(string), LicenseNumber: strPtr(m["licenseNumber"]),
		ClinicEmail: strPtr(m["clinicEmail"]), ApplicantStatementAccepted: m["applicantStatementAccepted"].(bool),
		SetFullName: true, SetCountry: true, SetSpecialty: true, SetMethod: true, SetLicense: true, SetEmail: true, SetStatement: true,
	}, reapply)
	if err != nil {
		fail(err)
		return
	}
	if a.VerificationMethod == "document_upload" && a.File == nil {
		codeError(w, http.StatusBadRequest, "Document upload is required for this verification method.", "DOCUMENT_REQUIRED")
		return
	}
	submitted, err := h.svc.Submit(r.Context(), uid, a.ID)
	if err != nil {
		fail(err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("application", submitted.DTO()))
}

func (h handlers) upload(w http.ResponseWriter, r *http.Request, uid string) {
	a, err := h.svc.Latest(r.Context(), uid)
	if err != nil {
		h.unhandled(w, err)
		return
	}
	switch {
	case a == nil:
		codeError(w, http.StatusBadRequest, "Create an application draft first.", "NO_APPLICATION")
		return
	case a.Status != "pending":
		codeError(w, http.StatusConflict, "Uploads are only allowed while application is pending.", "INVALID_STATUS")
		return
	case a.VerificationMethod != "document_upload":
		codeError(w, http.StatusBadRequest, "This application does not use document upload.", "METHOD_MISMATCH")
		return
	}
	form, err := httpx.ReadFormData(r)
	if err != nil {
		codeError(w, http.StatusBadRequest, "Invalid multipart/form-data", "INVALID_MULTIPART")
		return
	}
	entry := httpx.Get(form, "file")
	if entry == nil || entry.File == nil {
		codeError(w, http.StatusBadRequest, "Missing file field", "MISSING_FILE")
		return
	}
	saved, err := h.svc.ReplaceFile(r.Context(), a.ID, entry.File)
	switch {
	case errors.Is(err, doctorverify.ErrStorageMissing):
		codeError(w, http.StatusInternalServerError, "File storage is not configured.", "FILES_STORAGE_PATH_NOT_CONFIGURED")
	case errors.Is(err, doctorverify.ErrFileTooLarge):
		codeError(w, http.StatusRequestEntityTooLarge, "File too large (max 1MB).", "FILE_TOO_LARGE")
	case errors.Is(err, doctorverify.ErrInvalidMimeType):
		codeError(w, http.StatusUnsupportedMediaType, "Invalid file type. Allowed: PDF, JPG, PNG.", "INVALID_MIME_TYPE")
	case err != nil:
		h.d.Log.Error("Failed to upload file", "error", err)
		codeError(w, http.StatusInternalServerError, "Failed to upload file", err.Error())
	default:
		httpx.JSON(w, http.StatusOK, httpx.O("file", doctorverify.FileDTO(saved)))
	}
}

// byteString checks a header value the way undici's Headers did: it is a
// ByteString, so a character above U+00FF threw a TypeError. Next then wrote
// the value to the wire as UTF-8.
func byteString(s string) (string, bool) {
	for _, r := range s {
		if r > 0xFF {
			return "", false
		}
	}
	return s, true
}

func (h handlers) sendFile(w http.ResponseWriter, mime, name string, data []byte) {
	disposition, ok1 := byteString(`attachment; filename="` + name + `"`)
	contentType, ok2 := byteString(mime)
	if !ok1 || !ok2 {
		h.unhandled(w, errors.New("Cannot convert argument to a ByteString"))
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", disposition)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (h handlers) file(w http.ResponseWriter, r *http.Request, uid string) {
	f, err := h.d.Q.VerificationFileByID(r.Context(), chi.URLParam(r, "fileId"))
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	if err != nil {
		h.unhandled(w, err)
		return
	}
	a, err := h.d.Q.ApplicationByID(r.Context(), f.ApplicationID)
	missing := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !missing {
		h.unhandled(w, err)
		return
	}
	switch {
	case uid != "" && (missing || a.UserID != uid):
		httpx.Error(w, http.StatusForbidden, "Forbidden")
		return
	case uid == "" && missing:
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	if h.svc.StoragePath == "" {
		httpx.Error(w, http.StatusInternalServerError, "File storage is not configured")
		return
	}
	data, ok := h.svc.ReadFile(f.RelativePath)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "File missing on server")
		return
	}
	h.sendFile(w, f.MimeType, f.OriginalName, data)
}

func (h handlers) ownFile(w http.ResponseWriter, r *http.Request, uid string) { h.file(w, r, uid) }

func (h handlers) adminFile(w http.ResponseWriter, r *http.Request, _ string) { h.file(w, r, "") }

func (h handlers) listApplications(w http.ResponseWriter, r *http.Request, _ string) {
	status := "pending"
	if v, ok := r.URL.Query()["status"]; ok {
		status = v[0]
	}
	rows, err := h.d.Q.AdminApplications(r.Context(), status)
	if err != nil {
		h.unhandled(w, err)
		return
	}
	out := []any{}
	for _, a := range rows {
		if a.SubmittedAt == nil || a.SubmittedAt.IsZero() {
			continue
		}
		out = append(out, httpx.O("id", a.ID, "userId", a.UserID, "status", a.Status, "fullName", a.FullName,
			"country", a.Country, "specialty", a.Specialty, "verificationMethod", a.VerificationMethod,
			"submittedAt", jsontime.Format(a.SubmittedAt.Time), "createdAt", jsontime.Format(a.CreatedAt.Time)))
	}
	httpx.JSON(w, http.StatusOK, httpx.O("applications", out))
}

func (h handlers) applicationDetail(w http.ResponseWriter, r *http.Request, _ string) {
	a, err := h.svc.ForAdmin(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		h.unhandled(w, err)
		return
	}
	if a == nil {
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	dto, err := a.AdminDTO()
	if err != nil {
		h.unhandled(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("application", dto))
}

func (h handlers) review(w http.ResponseWriter, r *http.Request, uid string, approve bool) {
	s, failMsg := rejectSchema, "Failed to reject"
	if approve {
		s, failMsg = approveSchema, "Failed to approve"
	}
	m, ok := h.parse(w, r, s, true)
	if !ok {
		return
	}
	notes := strPtr(m["adminNotes"])
	if !approve && notes == nil {
		notes = strPtr(m["reason"])
	}
	err := h.svc.Review(r.Context(), chi.URLParam(r, "id"), uid, approve, notes, strPtr(m["userFacingNote"]))
	switch {
	case errors.Is(err, doctorverify.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Not found")
	case err != nil:
		h.d.Log.Error(failMsg, "error", err)
		httpx.Error(w, http.StatusInternalServerError, failMsg)
	default:
		httpx.JSON(w, http.StatusOK, httpx.O("success", true))
	}
}

func (h handlers) approve(w http.ResponseWriter, r *http.Request, uid string) {
	h.review(w, r, uid, true)
}

func (h handlers) reject(w http.ResponseWriter, r *http.Request, uid string) {
	h.review(w, r, uid, false)
}

// trimJS is String.prototype.trim().
func trimJS(s string) []uint16 { return jsx.CharCodes(jsx.Trim(s)) }

func (h handlers) ownFeatureRequests(w http.ResponseWriter, r *http.Request, uid string) {
	rows, err := h.d.Q.ListOwnFeatureRequests(r.Context(), uid)
	if err != nil {
		h.unhandled(w, err)
		return
	}
	if rows == nil {
		rows = []q.ListOwnFeatureRequestsRow{}
	}
	httpx.JSON(w, http.StatusOK, httpx.O("requests", rows))
}

// maxActiveRequests is MAX_ACTIVE_REQUESTS.
const maxActiveRequests = 3

func (h handlers) createFeatureRequest(w http.ResponseWriter, r *http.Request, uid string) {
	m, ok := h.parse(w, r, featureSchema, true)
	if !ok {
		return
	}
	active, err := h.d.Q.CountActiveFeatureRequests(r.Context(), uid)
	if err != nil {
		h.unhandled(w, err)
		return
	}
	if active >= maxActiveRequests {
		httpx.JSON(w, http.StatusConflict, httpx.O("error", "Active request limit reached", "code", "ACTIVE_REQUEST_LIMIT_REACHED",
			"maxActiveRequests", maxActiveRequests))
		return
	}
	created, err := h.d.Q.InsertFeatureRequest(r.Context(), uid, m["title"].(string), m["description"].(string))
	if err != nil {
		h.unhandled(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, httpx.O("request", created))
}

func (h handlers) allFeatureRequests(w http.ResponseWriter, r *http.Request, _ string) {
	rows, err := h.d.Q.ListAllFeatureRequests(r.Context())
	if err != nil {
		h.unhandled(w, err)
		return
	}
	if rows == nil {
		rows = []q.FeatureRequest{}
	}
	httpx.JSON(w, http.StatusOK, httpx.O("requests", rows))
}

func (h handlers) setResolution(w http.ResponseWriter, r *http.Request, _ string) {
	m, ok := h.parse(w, r, resolutionSchema, true)
	if !ok {
		return
	}
	rows, err := h.d.Q.SetFeatureRequestResolution(r.Context(), m["resolution"].(string), jsontime.New(h.d.Clock()), m["requestId"].(string))
	if err != nil {
		h.unhandled(w, err)
		return
	}
	if len(rows) == 0 {
		httpx.Error(w, http.StatusNotFound, "Not found")
		return
	}
	httpx.JSON(w, http.StatusOK, httpx.O("request", rows[0]))
}
