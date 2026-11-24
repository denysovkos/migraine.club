-- name: LatestApplication :one
SELECT * FROM doctor_verification_application WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1;

-- name: ApplicationByID :one
SELECT * FROM doctor_verification_application WHERE id = $1 LIMIT 1;

-- name: ApplicationFile :one
SELECT * FROM doctor_verification_file WHERE application_id = $1 LIMIT 1;

-- name: VerificationFileByID :one
SELECT * FROM doctor_verification_file WHERE id = $1 LIMIT 1;

-- name: InsertApplication :one
INSERT INTO doctor_verification_application (user_id, status, full_name, country, specialty, verification_method,
  license_number, clinic_email, applicant_statement_accepted, submitted_at)
VALUES (@user_id, 'pending', @full_name, @country, @specialty, @verification_method,
  sqlc.narg('license_number'), sqlc.narg('clinic_email'), @applicant_statement_accepted, NULL)
RETURNING *;

-- name: UpdateApplicationDraft :one
UPDATE doctor_verification_application SET
  full_name = CASE WHEN @set_full_name::bool THEN @full_name ELSE full_name END,
  country = CASE WHEN @set_country::bool THEN @country ELSE country END,
  specialty = CASE WHEN @set_specialty::bool THEN @specialty ELSE specialty END,
  verification_method = CASE WHEN @set_method::bool THEN @verification_method ELSE verification_method END,
  license_number = CASE WHEN @set_license::bool THEN sqlc.narg('license_number') ELSE license_number END,
  clinic_email = CASE WHEN @set_email::bool THEN sqlc.narg('clinic_email') ELSE clinic_email END,
  applicant_statement_accepted = CASE WHEN @set_statement::bool THEN @applicant_statement_accepted ELSE applicant_statement_accepted END,
  updated_at = @now
WHERE id = @id
RETURNING *;

-- name: SubmitApplication :one
UPDATE doctor_verification_application SET status = 'pending', submitted_at = @now, updated_at = @now
WHERE id = @id AND user_id = @user_id
RETURNING *;

-- name: SetUserDoctorRole :exec
UPDATE "user" SET role = @role, is_doctor = true, is_doctor_verified = @verified, updated_at = @now WHERE id = @id;

-- name: ReviewApplication :exec
UPDATE doctor_verification_application SET status = @status, reviewed_at = @now, reviewed_by_admin_id = @admin_id,
  admin_notes = sqlc.narg('admin_notes'), user_facing_note = sqlc.narg('user_facing_note'), updated_at = @now
WHERE id = @id;

-- name: AdminApplications :many
SELECT id, user_id, status, full_name, country, specialty, verification_method, submitted_at, created_at
FROM doctor_verification_application WHERE status = $1 ORDER BY submitted_at DESC;

-- name: DeleteVerificationFile :exec
DELETE FROM doctor_verification_file WHERE id = $1;

-- name: InsertVerificationFile :one
INSERT INTO doctor_verification_file (application_id, original_name, stored_name, relative_path, mime_type, size_bytes)
VALUES (@application_id, @original_name, @stored_name, @relative_path, @mime_type, @size_bytes)
RETURNING *;

-- name: ListOwnFeatureRequests :many
SELECT id, title, description, resolution, created_at, updated_at FROM feature_request
WHERE user_id = $1 ORDER BY created_at DESC;

-- name: CountActiveFeatureRequests :one
SELECT count(*) FROM feature_request WHERE user_id = $1 AND resolution IN ('SENT', 'IN REVIEW');

-- name: InsertFeatureRequest :one
INSERT INTO feature_request (user_id, title, description, resolution) VALUES (@user_id, @title, @description, 'SENT')
RETURNING id, title, description, resolution, created_at, updated_at;

-- name: ListAllFeatureRequests :many
SELECT id, user_id, title, description, resolution, created_at, updated_at FROM feature_request ORDER BY created_at DESC;

-- name: SetFeatureRequestResolution :many
UPDATE feature_request SET resolution = @resolution, updated_at = @now WHERE id = @id
RETURNING id, resolution, updated_at;
