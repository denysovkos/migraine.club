-- name: LatestSolarBySource :one
SELECT * FROM solar_activity_snapshot
WHERE source = $1
ORDER BY timestamp_utc DESC
LIMIT 1;

-- name: InsertSolarSnapshot :many
INSERT INTO solar_activity_snapshot (timestamp_utc, kp_index, source, raw)
VALUES (@timestamp_utc, @kp_index, @source, @raw)
ON CONFLICT DO NOTHING
RETURNING id;

-- name: SolarSnapshotBySourceAt :one
SELECT id FROM solar_activity_snapshot WHERE source = $1 AND timestamp_utc = $2 LIMIT 1;

-- name: SolarSnapshotByID :one
SELECT * FROM solar_activity_snapshot WHERE id = $1 LIMIT 1;

-- name: SolarSnapshotsBetween :many
SELECT kp_index, timestamp_utc FROM solar_activity_snapshot
WHERE timestamp_utc >= @start_time AND timestamp_utc <= @end_time
  AND source = ANY(@sources::text[]);
