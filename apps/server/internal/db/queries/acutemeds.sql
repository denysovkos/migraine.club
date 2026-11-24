-- name: MohDoseRows :many
SELECT d.taken_at, m.medication_class FROM acute_doses d INNER JOIN user_medications m ON d.medication_id = m.id
WHERE d.user_id = @user_id AND m.is_acute = true AND d.taken_at >= @from_ts AND d.taken_at < @to_ts;

-- name: AcuteReportRows :many
SELECT d.id AS dose_id, d.medication_id, m.custom_name, c.canonical_name, m.medication_class, d.taken_at,
  o.helped, o.time_to_relief_minutes
FROM acute_doses d
INNER JOIN user_medications m ON d.medication_id = m.id
LEFT JOIN medications_catalog c ON m.catalog_medication_id = c.id
LEFT JOIN dose_outcomes o ON d.id = o.dose_id
WHERE d.user_id = @user_id AND m.is_acute = true AND d.taken_at >= @from_ts AND d.taken_at < @to_ts;
