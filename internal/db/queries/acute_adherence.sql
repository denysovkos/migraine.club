-- name: ActiveEnrollment :one
SELECT * FROM program_enrollment
WHERE user_id = @user_id AND program_id = @program_id AND status = 'active'
LIMIT 1;

-- name: AttackOnset :one
SELECT id, start_time, onset_at FROM episode WHERE id = @id AND user_id = @user_id LIMIT 1;

-- name: FirstDoseForAttack :one
SELECT taken_at FROM acute_doses
WHERE attack_id = @attack_id AND user_id = @user_id
ORDER BY taken_at ASC
LIMIT 1;

-- name: AdherenceEventForAttack :one
SELECT id FROM program_adherence_event
WHERE enrollment_id = @enrollment_id AND attack_id = @attack_id
LIMIT 1;

-- name: UpdateAdherenceEvent :exec
UPDATE program_adherence_event SET signal = @signal, source = @source, payload = @payload WHERE id = @id;

-- name: InsertAttackAdherenceEvent :exec
INSERT INTO program_adherence_event (enrollment_id, user_id, program_id, attack_id, signal, source, payload)
VALUES (@enrollment_id, @user_id, @program_id, @attack_id, @signal, @source, @payload);
