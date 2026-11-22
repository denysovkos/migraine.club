-- name: UserRole :one
SELECT role FROM "user" WHERE id = $1 LIMIT 1;

-- name: OwnEpisodeExists :one
SELECT id FROM episode WHERE id = @id AND user_id = @user_id LIMIT 1;

-- name: InsertCommunityPost :one
INSERT INTO community_post (author_id, episode_id, title, body, tags, is_anonymous, is_from_episode)
VALUES (@author_id, sqlc.narg('episode_id'), @title, @body, sqlc.narg('tags'), @is_anonymous, @is_from_episode)
RETURNING id;

-- name: ListCommunityPostsNew :many
SELECT p.id, p.title, p.body, p.episode_id, p.tags, p.score, p.is_from_episode, p.is_anonymous, p.created_at,
  p.author_id, p.visibility, u.id AS user_id, u.display_name, u.community_handle, u.role AS user_role,
  a.specialty AS doctor_specialty
FROM community_post p
LEFT JOIN "user" u ON p.author_id = u.id
LEFT JOIN doctor_verification_application a ON a.user_id = u.id AND a.status = 'approved'
WHERE (p.visibility = 'PUBLIC' OR (@moderator::bool AND p.visibility = 'HIDDEN'))
  AND (sqlc.narg('tag')::text IS NULL OR p.tags LIKE sqlc.narg('tag'))
  AND (sqlc.narg('author')::text IS NULL OR p.author_id = sqlc.narg('author'))
ORDER BY p.created_at DESC
LIMIT @lim::bigint OFFSET @off::bigint;

-- name: ListCommunityPostsTop :many
SELECT p.id, p.title, p.body, p.episode_id, p.tags, p.score, p.is_from_episode, p.is_anonymous, p.created_at,
  p.author_id, p.visibility, u.id AS user_id, u.display_name, u.community_handle, u.role AS user_role,
  a.specialty AS doctor_specialty
FROM community_post p
LEFT JOIN "user" u ON p.author_id = u.id
LEFT JOIN doctor_verification_application a ON a.user_id = u.id AND a.status = 'approved'
WHERE (p.visibility = 'PUBLIC' OR (@moderator::bool AND p.visibility = 'HIDDEN'))
  AND (sqlc.narg('tag')::text IS NULL OR p.tags LIKE sqlc.narg('tag'))
  AND (sqlc.narg('author')::text IS NULL OR p.author_id = sqlc.narg('author'))
ORDER BY p.score DESC, p.created_at DESC
LIMIT @lim::bigint OFFSET @off::bigint;

-- name: ViewerVotes :many
SELECT post_id, value FROM community_vote WHERE user_id = @user_id AND post_id = ANY(@post_ids::uuid[]);

-- name: CommentCounts :many
SELECT post_id, count(*) AS count FROM community_comment WHERE post_id = ANY(@post_ids::uuid[]) GROUP BY post_id;

-- name: OpenReportCounts :many
SELECT post_id, count(*) AS count FROM community_report
WHERE post_id = ANY(@post_ids::uuid[]) AND status = 'OPEN' GROUP BY post_id;

-- name: CommunityPostDetail :one
SELECT p.id, p.title, p.body, p.tags, p.score, p.is_from_episode, p.episode_id, p.is_anonymous, p.created_at,
  p.updated_at, p.author_id, p.visibility, u.id AS user_id, u.display_name, u.community_handle, u.role AS user_role,
  a.specialty AS doctor_specialty
FROM community_post p
LEFT JOIN "user" u ON p.author_id = u.id
LEFT JOIN doctor_verification_application a ON a.user_id = u.id AND a.status = 'approved'
WHERE p.id = @id AND (p.visibility = 'PUBLIC' OR (@moderator::bool AND p.visibility = 'HIDDEN'))
LIMIT 1;

-- name: ViewerVote :one
SELECT value FROM community_vote WHERE post_id = @post_id AND user_id = @user_id LIMIT 1;

-- name: PostComments :many
SELECT c.id, c.post_id, c.parent_comment_id, c.body, c.is_anonymous, c.created_at, c.author_id AS comment_author_id,
  c.visibility, u.id AS user_id, u.display_name, u.community_handle, u.role AS user_role,
  a.specialty AS doctor_specialty
FROM community_comment c
LEFT JOIN "user" u ON c.author_id = u.id
LEFT JOIN doctor_verification_application a ON a.user_id = u.id AND a.status = 'approved'
WHERE c.post_id = @post_id AND (c.visibility = 'PUBLIC' OR (@moderator::bool AND c.visibility = 'HIDDEN'))
ORDER BY c.created_at;

-- name: PostForVote :one
SELECT id, score, visibility FROM community_post WHERE id = $1 LIMIT 1;

-- name: ExistingVote :one
SELECT id, value FROM community_vote WHERE post_id = @post_id AND user_id = @user_id LIMIT 1;

-- name: DeleteVote :exec
DELETE FROM community_vote WHERE id = $1;

-- name: InsertVote :exec
INSERT INTO community_vote (post_id, user_id, value) VALUES (@post_id, @user_id, @value);

-- name: UpdateVote :exec
UPDATE community_vote SET value = @value, updated_at = @now WHERE id = @id;

-- name: SetPostScore :exec
UPDATE community_post SET score = @score, updated_at = @now WHERE id = @id;

-- name: InsertComment :one
INSERT INTO community_comment (post_id, author_id, parent_comment_id, body, is_anonymous)
VALUES (@post_id, @author_id, sqlc.narg('parent_comment_id'), @body, @is_anonymous)
RETURNING *;

-- name: InsertReport :exec
INSERT INTO community_report (post_id, comment_id, reporter_id, reason, details, status)
VALUES (sqlc.narg('post_id'), sqlc.narg('comment_id'), @reporter_id, @reason, sqlc.narg('details'), 'OPEN');

-- name: OpenReports :many
SELECT id, post_id, comment_id, reason, details, status, created_at FROM community_report
WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT $1;

-- name: ReportPost :one
SELECT title, body, is_anonymous, author_id FROM community_post WHERE id = $1 LIMIT 1;

-- name: ReportComment :one
SELECT body, is_anonymous, author_id FROM community_comment WHERE id = $1 LIMIT 1;

-- name: OpenReportCountForPost :one
SELECT count(*) FROM community_report WHERE post_id = $1 AND status = 'OPEN';

-- name: ResolveReport :many
UPDATE community_report SET status = @status, resolved_by = @resolved_by, resolved_at = @now
WHERE id = @id RETURNING id;

-- name: SetPostVisibility :many
UPDATE community_post SET visibility = @visibility, updated_at = @now WHERE id = @id RETURNING id;

-- name: SetCommentVisibility :many
UPDATE community_comment SET visibility = @visibility, updated_at = @now WHERE id = @id RETURNING id;

-- name: HiddenPosts :many
SELECT id, title, body, is_anonymous, updated_at, author_id FROM community_post
WHERE visibility = 'HIDDEN' ORDER BY updated_at DESC LIMIT $1;

-- name: HiddenComments :many
SELECT id, body, is_anonymous, updated_at, author_id, post_id FROM community_comment
WHERE visibility = 'HIDDEN' ORDER BY updated_at DESC LIMIT $1;

-- name: SetUserRole :many
UPDATE "user" SET role = @role, updated_at = @now WHERE id = @id RETURNING id;

-- name: ModerationUsers :many
SELECT id, community_handle, role, is_doctor, is_doctor_verified, created_at FROM "user"
ORDER BY created_at DESC LIMIT $1;

-- name: ModerationUsersSearch :many
SELECT id, community_handle, role, is_doctor, is_doctor_verified, created_at FROM "user"
WHERE community_handle ILIKE @pattern OR id ILIKE @pattern
ORDER BY created_at DESC LIMIT @lim;

-- name: StatsPostsSince :one
SELECT count(*) FROM community_post WHERE visibility = 'PUBLIC' AND created_at >= $1;

-- name: StatsActiveAuthors :many
SELECT DISTINCT author_id FROM community_post WHERE visibility = 'PUBLIC' AND created_at >= $1;

-- name: StatsRecentTags :many
SELECT tags FROM community_post WHERE visibility = 'PUBLIC' AND created_at >= $1;
