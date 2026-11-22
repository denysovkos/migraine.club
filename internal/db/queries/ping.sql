-- name: Ping :one
SELECT 1::int AS one;

-- name: ScanProbe :one
SELECT now()::date AS d, gen_random_uuid() AS u, now()::timestamp AS ts, '12:30'::time AS t;
