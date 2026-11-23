-- name: ListQuestionnaireResponses :many
SELECT * FROM questionnaire_responses
WHERE user_id = @user_id AND (sqlc.narg('type')::text IS NULL OR type = sqlc.narg('type'))
ORDER BY taken_at DESC LIMIT @lim;

-- name: InsertQuestionnaireResponse :one
INSERT INTO questionnaire_responses (user_id, type, taken_at, period_start, period_end, answers, score_total, score_details)
VALUES (@user_id, @type, @taken_at, sqlc.narg('period_start'), sqlc.narg('period_end'), @answers, sqlc.narg('score_total'), sqlc.narg('score_details'))
RETURNING *;
