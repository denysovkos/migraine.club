// Package doctorverify is src/services/DoctorVerificationService and
// DoctorVerificationFileStorage: doctor applications, their single
// document, and the admin review.
package doctorverify

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/denysovkos/migraine.club/internal/db/q"
	"github.com/denysovkos/migraine.club/internal/httpx"
	"github.com/denysovkos/migraine.club/internal/jsontime"
	"github.com/denysovkos/migraine.club/internal/jsx"
)

// Error codes the services threw as Error messages.
var (
	ErrApprovedLocked  = errors.New("APPLICATION_APPROVED_LOCKED")
	ErrRejectedLocked  = errors.New("APPLICATION_REJECTED_LOCKED")
	ErrNotFound        = errors.New("NOT_FOUND")
	ErrFailedToSubmit  = errors.New("FAILED_TO_SUBMIT")
	ErrStorageMissing  = errors.New("FILES_STORAGE_PATH_NOT_CONFIGURED")
	ErrFileTooLarge    = errors.New("FILE_TOO_LARGE")
	ErrInvalidMimeType = errors.New("INVALID_MIME_TYPE")
)

// Service is DoctorVerificationService plus the file storage.
type Service struct {
	Q           *q.Queries
	Log         *slog.Logger
	Now         func() time.Time
	StoragePath string
}

// Application is DoctorVerificationApplicationWithFile.
type Application struct {
	q.DoctorVerificationApplication
	File *q.DoctorVerificationFile
}

func (s *Service) withFile(ctx context.Context, app q.DoctorVerificationApplication) (*Application, error) {
	f, err := s.Q.ApplicationFile(ctx, app.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &Application{app, nil}, nil
	}
	if err != nil {
		return nil, err
	}
	return &Application{app, &f}, nil
}

// Latest is getLatestForUser; nil without an application.
func (s *Service) Latest(ctx context.Context, uid string) (*Application, error) {
	app, err := s.Q.LatestApplication(ctx, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.withFile(ctx, app)
}

// ForAdmin is getForAdmin; nil when missing.
func (s *Service) ForAdmin(ctx context.Context, id string) (*Application, error) {
	app, err := s.Q.ApplicationByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.withFile(ctx, app)
}

// Draft is saveDraft's input; Set* mark keys present in it.
type Draft struct {
	FullName, Country, Specialty, VerificationMethod string
	LicenseNumber, ClinicEmail                       *string
	ApplicantStatementAccepted                       bool

	SetFullName, SetCountry, SetSpecialty, SetMethod, SetLicense, SetEmail, SetStatement bool
}

// SaveDraft is saveDraft.
func (s *Service) SaveDraft(ctx context.Context, uid string, in Draft, allowCreateIfRejected bool) (*Application, error) {
	latest, err := s.Latest(ctx, uid)
	if err != nil {
		return nil, err
	}
	if latest != nil && latest.Status == "approved" {
		return nil, ErrApprovedLocked
	}
	if latest == nil || (latest.Status == "rejected" && allowCreateIfRejected) {
		or := func(set bool, v, def string) string {
			if set {
				return v
			}
			return def
		}
		created, err := s.Q.InsertApplication(ctx, q.InsertApplicationParams{UserID: uid,
			FullName: or(in.SetFullName, in.FullName, ""), Country: or(in.SetCountry, in.Country, ""),
			Specialty: or(in.SetSpecialty, in.Specialty, "other"), VerificationMethod: or(in.SetMethod, in.VerificationMethod, "license_number"),
			LicenseNumber: in.LicenseNumber, ClinicEmail: in.ClinicEmail,
			ApplicantStatementAccepted: in.SetStatement && in.ApplicantStatementAccepted})
		if err != nil {
			return nil, err
		}
		return &Application{created, nil}, nil
	}
	if latest.Status == "rejected" {
		return nil, ErrRejectedLocked
	}
	updated, err := s.Q.UpdateApplicationDraft(ctx, q.UpdateApplicationDraftParams{
		SetFullName: in.SetFullName, FullName: in.FullName, SetCountry: in.SetCountry, Country: in.Country,
		SetSpecialty: in.SetSpecialty, Specialty: in.Specialty, SetMethod: in.SetMethod, VerificationMethod: in.VerificationMethod,
		SetLicense: in.SetLicense, LicenseNumber: in.LicenseNumber, SetEmail: in.SetEmail, ClinicEmail: in.ClinicEmail,
		SetStatement: in.SetStatement, ApplicantStatementAccepted: in.ApplicantStatementAccepted,
		Now: jsontime.New(s.Now()), ID: latest.ID})
	if err != nil {
		return nil, err
	}
	return s.withFile(ctx, updated)
}

// Submit is submitApplication.
func (s *Service) Submit(ctx context.Context, uid, appID string) (*Application, error) {
	now := s.Now()
	app, err := s.Q.SubmitApplication(ctx, jsontime.Ptr(now), appID, uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrFailedToSubmit
	}
	if err != nil {
		return nil, err
	}
	if err := s.Q.SetUserDoctorRole(ctx, "doctor_pending", false, jsontime.New(now), uid); err != nil {
		return nil, err
	}
	return s.withFile(ctx, app)
}

// Review is approveAdmin / rejectAdmin. adminNotes is already resolved.
func (s *Service) Review(ctx context.Context, id, admin string, approve bool, adminNotes, userNote *string) error {
	app, err := s.ForAdmin(ctx, id)
	if err != nil {
		return err
	}
	if app == nil {
		return ErrNotFound
	}
	now := s.Now()
	status, role, msg := "rejected", "doctor_rejected", "Doctor verification rejected"
	if approve {
		status, role, msg = "approved", "doctor_verified", "Doctor verification approved"
	}
	if err := s.Q.ReviewApplication(ctx, q.ReviewApplicationParams{Status: status, Now: jsontime.Ptr(now), AdminID: &admin,
		AdminNotes: adminNotes, UserFacingNote: userNote, ID: app.ID}); err != nil {
		return err
	}
	if err := s.Q.SetUserDoctorRole(ctx, role, approve, jsontime.New(now), app.UserID); err != nil {
		return err
	}
	s.Log.Info(msg, "applicationId", app.ID, "userId", app.UserID, "adminUserId", admin)
	return nil
}

// FileDTO is DoctorVerificationFileDto.
func FileDTO(f *q.DoctorVerificationFile) any {
	if f == nil {
		return nil
	}
	return httpx.O("id", f.ID, "applicationId", f.ApplicationID, "originalName", f.OriginalName, "mimeType", f.MimeType,
		"sizeBytes", f.SizeBytes, "createdAt", jsontime.Format(f.CreatedAt.Time))
}

func iso(t *jsontime.Time) any {
	if t == nil || t.IsZero() {
		return nil
	}
	return jsontime.Format(t.Time)
}

// DTO is the applicant route's toDto.
func (a *Application) DTO() *httpx.Object {
	return httpx.O("id", a.ID, "userId", a.UserID, "status", a.Status, "fullName", a.FullName, "country", a.Country,
		"specialty", a.Specialty, "verificationMethod", a.VerificationMethod, "licenseNumber", a.LicenseNumber,
		"clinicEmail", a.ClinicEmail, "applicantStatementAccepted", a.ApplicantStatementAccepted,
		"submittedAt", iso(a.SubmittedAt), "reviewedAt", iso(a.ReviewedAt), "reviewedByAdminId", a.ReviewedByAdminID,
		"adminNotes", a.AdminNotes, "userFacingNote", a.UserFacingNote, "createdAt", jsontime.Format(a.CreatedAt.Time),
		"updatedAt", jsontime.Format(a.UpdatedAt.Time), "file", FileDTO(a.File))
}

// AdminDTO is `{ ...app, ...dates, file }`: every column in schema order,
// then the file.
func (a *Application) AdminDTO() (*jsx.JSONObject, error) {
	b, err := a.MarshalJSON()
	if err != nil {
		return nil, err
	}
	v, err := jsx.ParseJSON(b)
	if err != nil {
		return nil, err
	}
	o := v.(*jsx.JSONObject)
	fb, err := httpx.Marshal(FileDTO(a.File))
	if err != nil {
		return nil, err
	}
	f, _ := jsx.ParseJSON(fb)
	return o.Set("file", f), nil
}

const maxUploadBytes = 1 * 1024 * 1024

var extForMime = map[string]string{"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}

// SafeFilename is safeFilename.
func SafeFilename(name string) string {
	out := []rune{}
	units := 0
	for _, r := range name {
		if r == '/' || r == '\\' {
			out = append(out, '_')
			units++
			continue
		}
		if r < 0x20 || r == 0x7f {
			continue
		}
		out = append(out, r)
		if r > 0xFFFF {
			units += 2
		} else {
			units++
		}
		if units >= 200 {
			break
		}
	}
	if len(out) == 0 {
		return "document"
	}
	return string(out)
}

// ReplaceFile is replaceSingleFile.
func (s *Service) ReplaceFile(ctx context.Context, appID string, f *httpx.FormFile) (*q.DoctorVerificationFile, error) {
	if len(f.Data) > maxUploadBytes {
		return nil, ErrFileTooLarge
	}
	ext, ok := extForMime[f.Type]
	if !ok {
		return nil, ErrInvalidMimeType
	}
	if s.StoragePath == "" {
		return nil, ErrStorageMissing
	}
	dir := filepath.Join(s.StoragePath, "doctor-verification", appID)
	if err := os.MkdirAll(dir, 0o777); err != nil {
		return nil, err
	}
	stored := uuid.NewString() + "." + ext
	rel := filepath.Join("doctor-verification", appID, stored)
	if err := os.WriteFile(filepath.Join(s.StoragePath, rel), f.Data, 0o666); err != nil { //nolint:gosec // same mode as fs.writeFile
		return nil, err
	}
	existing, err := s.Q.ApplicationFile(ctx, appID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return nil, err
	default:
		if err := os.Remove(filepath.Join(s.StoragePath, existing.RelativePath)); err != nil {
			s.Log.Warn("Failed to delete old doctor verification file", "error", err, "fileId", existing.ID)
		}
		if err := s.Q.DeleteVerificationFile(ctx, existing.ID); err != nil {
			return nil, err
		}
	}
	created, err := s.Q.InsertVerificationFile(ctx, q.InsertVerificationFileParams{ApplicationID: appID,
		OriginalName: SafeFilename(f.Name), StoredName: stored, RelativePath: rel, MimeType: f.Type,
		SizeBytes: int32(len(f.Data))}) //nolint:gosec // at most 1 MiB
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// ReadFile reads a stored document; ok is false when it is missing.
func (s *Service) ReadFile(rel string) ([]byte, bool) {
	b, err := os.ReadFile(filepath.Join(s.StoragePath, rel)) //nolint:gosec // path comes from our own row
	return b, err == nil
}
