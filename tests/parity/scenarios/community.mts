import type { Scenario } from '../run.mts';

const U = `'e2e_user_test_001'`;
const DOC = 'parity_doctor_user';
const PEND = 'parity_pending_user';
const P = (n: number) => `cccccccc-0000-4000-8000-00000000000${n}`;
const C = (n: number) => `cccccccc-0000-4000-8000-0000000000c${n}`;
const R = (n: number) => `cccccccc-0000-4000-8000-0000000000e${n}`;
const LONG = `${'a'.repeat(239)}😀tail`;

const cleanup = [
  `DELETE FROM community_report WHERE reporter_id IN (${U}, '${DOC}', '${PEND}') OR post_id::text LIKE 'cccccccc%'`,
  `DELETE FROM community_vote WHERE post_id::text LIKE 'cccccccc%' OR user_id IN (${U}, '${DOC}', '${PEND}')`,
  `DELETE FROM community_comment WHERE post_id::text LIKE 'cccccccc%' OR author_id IN (${U}, '${DOC}', '${PEND}')`,
  `DELETE FROM community_post WHERE id::text LIKE 'cccccccc%' OR author_id IN (${U}, '${DOC}', '${PEND}')`,
  `DELETE FROM doctor_verification_application WHERE user_id IN ('${DOC}', '${PEND}')`,
  `DELETE FROM "user" WHERE id IN ('${DOC}', '${PEND}')`,
];

// Stats read posts without ORDER BY, and the tag tally's NaN comparator makes
// the result depend on that order: start both runs from a compacted heap.
const setup = [
  ...cleanup,
  'VACUUM FULL community_post',
  `INSERT INTO "user" (id, display_name, community_handle, role, created_at) VALUES
    ('${DOC}', 'Dr Who', 'drwho', 'doctor_verified', now() - interval '2 day'),
    ('${PEND}', '', 'pending_handle', 'doctor_pending', now() - interval '1 day')`,
  `INSERT INTO doctor_verification_application (user_id, status, full_name, country, specialty, verification_method)
    VALUES ('${DOC}', 'approved', 'Dr Who', 'DE', 'neurologist', 'license'), ('${PEND}', 'pending', 'P', 'DE', 'gp', 'license')`,
  `INSERT INTO community_post (id, author_id, title, body, tags, is_anonymous, score, visibility, created_at) VALUES
    ('${P(1)}', '${DOC}', 'Doctor post', '${LONG}', ' migraine, sleep ,,', false, 3, 'PUBLIC', now() - interval '1 hour'),
    ('${P(2)}', '${PEND}', 'Pending post', 'short', 'sleep', false, 7, 'PUBLIC', now() - interval '2 hour'),
    ('${P(3)}', '${DOC}', 'Anon post', 'anon body', NULL, true, 1, 'PUBLIC', now() - interval '3 hour'),
    ('${P(4)}', '${DOC}', 'Hidden post', 'hidden body', 'constructor,__proto__,constructor', false, 9, 'HIDDEN', now() - interval '4 hour'),
    ('${P(5)}', ${U}, 'My post', 'mine', 'toString,valueOf,migraine', false, 0, 'PUBLIC', now() - interval '5 hour'),
    ('${P(6)}', 'ghost_author', 'Ghost post', 'no user row', '', false, 0, 'PUBLIC', now() - interval '6 hour'),
    ('${P(7)}', '${DOC}', 'Old post', 'old', 'old', false, 0, 'PUBLIC', now() - interval '9 day')`,
  `INSERT INTO community_comment (id, post_id, author_id, body, is_anonymous, visibility, created_at) VALUES
    ('${C(1)}', '${P(1)}', '${PEND}', 'pending comment', false, 'PUBLIC', now() - interval '50 minute'),
    ('${C(2)}', '${P(1)}', ${U}, 'my anon comment', true, 'PUBLIC', now() - interval '40 minute'),
    ('${C(3)}', '${P(1)}', '${DOC}', '${'b'.repeat(149)}😀 hidden', false, 'HIDDEN', now() - interval '30 minute'),
    ('${C(4)}', '${P(1)}', 'ghost_author', 'ghost comment', false, 'PUBLIC', now() - interval '20 minute')`,
  // Distinct hide times: the hidden list sorts by them, and two inserts can
  // land in the same millisecond.
  `UPDATE community_post SET updated_at = now() - interval '2 minute' WHERE id = '${P(4)}'`,
  `INSERT INTO community_vote (post_id, user_id, value) VALUES ('${P(2)}', ${U}, 1), ('${P(1)}', '${DOC}', 1)`,
  `INSERT INTO community_report (id, post_id, comment_id, reporter_id, reason, details, created_at) VALUES
    ('${R(1)}', '${P(1)}', NULL, '${PEND}', 'spam', 'details', now() - interval '3 minute'),
    ('${R(2)}', NULL, '${C(3)}', '${PEND}', 'abuse', NULL, now() - interval '2 minute'),
    ('${R(3)}', '${P(3)}', NULL, '${PEND}', 'other', NULL, now() - interval '1 minute')`,
];

const asRole = (role: string) => [...setup, `UPDATE "user" SET role = '${role}' WHERE id = ${U}`];

const scenarios: Scenario[] = [
  {
    name: 'community as a regular user',
    sql: setup,
    steps: [
      { name: 'list', path: '/api/community/posts' },
      { name: 'list-top', path: '/api/community/posts?sort=top' },
      { name: 'list-tag', path: '/api/community/posts?tag=sleep' },
      { name: 'list-tag-empty', path: '/api/community/posts?tag=' },
      { name: 'list-own', path: '/api/community/posts?onlyOwn=0' },
      { name: 'list-page', path: '/api/community/posts?page=2&limit=2' },
      { name: 'list-page-far', path: '/api/community/posts?page=99999999999999999999' },
      { name: 'list-parse', path: '/api/community/posts?page=1.9x&limit=3abc' },
      { name: 'list-bad', path: `/api/community/posts?page=abc&limit=51&sort=x&tag=${'t'.repeat(33)}` },
      { name: 'list-bad-page', path: '/api/community/posts?page=0&sort=' },
      { name: 'get', path: `/api/community/posts/${P(1)}` },
      { name: 'get-ghost', path: `/api/community/posts/${P(6)}` },
      { name: 'get-hidden', path: `/api/community/posts/${P(4)}` },
      { name: 'get-missing', path: '/api/community/posts/cccccccc-0000-4000-8000-0000000000ff' },
      { name: 'get-bad-id', path: '/api/community/posts/abc' },
      { name: 'vote-up', method: 'POST', path: `/api/community/posts/${P(1)}/vote`, body: { value: 1 } },
      { name: 'vote-up-again', method: 'POST', path: `/api/community/posts/${P(1)}/vote`, body: { value: 1 } },
      { name: 'vote-down', method: 'POST', path: `/api/community/posts/${P(1)}/vote`, body: { value: -1 } },
      { name: 'vote-clear', method: 'POST', path: `/api/community/posts/${P(1)}/vote`, body: { value: 0 } },
      { name: 'vote-clear-none', method: 'POST', path: `/api/community/posts/${P(3)}/vote`, body: { value: 0 } },
      { name: 'vote-bad', method: 'POST', path: `/api/community/posts/${P(1)}/vote`, body: { value: 2 } },
      { name: 'vote-string', method: 'POST', path: `/api/community/posts/${P(1)}/vote`, body: { value: '1' } },
      { name: 'vote-hidden', method: 'POST', path: `/api/community/posts/${P(4)}/vote`, body: { value: 1 } },
      { name: 'vote-bad-json', method: 'POST', path: `/api/community/posts/${P(1)}/vote`, rawBody: '{' },
      { name: 'vote-bad-id', method: 'POST', path: '/api/community/posts/abc/vote', body: { value: 1 } },
      { name: 'create', method: 'POST', path: '/api/community/posts', body: { title: 'New post', body: 'Hello', tags: ['a', ' b ', 'c,d'], isAnonymous: false } },
      { name: 'create-default-anon', method: 'POST', path: '/api/community/posts', body: { title: 'Anon new', body: 'x' } },
      { name: 'create-invalid', method: 'POST', path: '/api/community/posts', body: { title: 'x', body: '', tags: ['', 'y'.repeat(33), 1, 2, 3, 4, 5, 6, 7], episodeId: 1.5, isAnonymous: 'no' } },
      { name: 'create-foreign-episode', method: 'POST', path: '/api/community/posts', body: { title: 'With episode', body: 'x', episodeId: 123456789 } },
      { name: 'create-huge-episode', method: 'POST', path: '/api/community/posts', body: { title: 'With episode', body: 'x', episodeId: 3000000000 } },
      { name: 'create-bad-json', method: 'POST', path: '/api/community/posts', rawBody: 'nope' },
      { name: 'comment', method: 'POST', path: '/api/community/comments', body: { postId: P(1), body: 'Nice', isAnonymous: false } },
      { name: 'comment-reply', method: 'POST', path: '/api/community/comments', body: { postId: P(1), parentCommentId: C(1), body: 'Reply' } },
      { name: 'comment-hidden-post', method: 'POST', path: '/api/community/comments', body: { postId: P(4), body: 'x' } },
      { name: 'comment-invalid', method: 'POST', path: '/api/community/comments', body: { postId: 'x', parentCommentId: 5, body: '' } },
      { name: 'comment-bad-parent', method: 'POST', path: '/api/community/comments', body: { postId: P(1), parentCommentId: 'cccccccc-0000-4000-8000-0000000000ff', body: 'x' } },
      { name: 'get-after', path: `/api/community/posts/${P(1)}` },
      { name: 'report-post', method: 'POST', path: '/api/community/report', body: { postId: P(2), reason: 'spam', details: 'why' } },
      { name: 'report-comment', method: 'POST', path: '/api/community/report', body: { commentId: C(1), reason: 'abuse' } },
      { name: 'report-both', method: 'POST', path: '/api/community/report', body: { postId: P(2), commentId: C(1), reason: 'spam' } },
      { name: 'report-none', method: 'POST', path: '/api/community/report', body: { reason: 'spam' } },
      { name: 'report-invalid', method: 'POST', path: '/api/community/report', body: { postId: 'x', reason: 'rude', details: 5 } },
      { name: 'report-missing-post', method: 'POST', path: '/api/community/report', body: { postId: 'cccccccc-0000-4000-8000-0000000000ff', reason: 'spam' } },
      { name: 'stats', path: '/api/community/stats' },
      { name: 'role', path: '/api/moderation/role' },
      { name: 'mod-reports', path: '/api/moderation/reports' },
      { name: 'mod-resolve', method: 'POST', path: '/api/moderation/reports', body: {} },
      { name: 'mod-visibility', path: '/api/moderation/visibility' },
      { name: 'mod-users', path: '/api/moderation/users' },
      { name: 'list-final', path: '/api/community/posts' },
    ],
  },
  {
    name: 'community as a moderator',
    sql: asRole('moderator'),
    steps: [
      { name: 'role', path: '/api/moderation/role' },
      { name: 'list', path: '/api/community/posts?sort=top' },
      { name: 'get-hidden', path: `/api/community/posts/${P(4)}` },
      { name: 'get', path: `/api/community/posts/${P(1)}` },
      { name: 'reports', path: '/api/moderation/reports' },
      { name: 'resolve', method: 'POST', path: '/api/moderation/reports', body: { reportId: R(1), status: 'RESOLVED' } },
      { name: 'resolve-missing', method: 'POST', path: '/api/moderation/reports', body: { reportId: 'cccccccc-0000-4000-8000-0000000000ff', status: 'DISMISSED' } },
      { name: 'resolve-invalid', method: 'POST', path: '/api/moderation/reports', body: { reportId: 'x', status: 'OPEN' } },
      { name: 'resolve-bad-json', method: 'POST', path: '/api/moderation/reports', rawBody: '{' },
      { name: 'reports-after', path: '/api/moderation/reports' },
      { name: 'hidden', path: '/api/moderation/visibility' },
      { name: 'hide-post', method: 'POST', path: '/api/moderation/visibility', body: { postId: P(2), visibility: 'HIDDEN' } },
      { name: 'unhide-comment', method: 'POST', path: '/api/moderation/visibility', body: { commentId: C(3), visibility: 'PUBLIC' } },
      { name: 'hide-missing', method: 'POST', path: '/api/moderation/visibility', body: { commentId: 'cccccccc-0000-4000-8000-0000000000ff', visibility: 'HIDDEN' } },
      { name: 'hide-invalid', method: 'POST', path: '/api/moderation/visibility', body: { postId: P(2), commentId: C(3), visibility: 'DELETED' } },
      { name: 'hidden-after', path: '/api/moderation/visibility' },
      { name: 'users-forbidden', path: '/api/moderation/users' },
    ],
  },
  {
    name: 'moderation as an admin',
    sql: asRole('admin'),
    steps: [
      { name: 'role', path: '/api/moderation/role' },
      { name: 'users', path: '/api/moderation/users' },
      { name: 'users-search', path: '/api/moderation/users?search=HANDLE' },
      { name: 'users-search-id', path: '/api/moderation/users?search=parity_doc' },
      { name: 'users-search-empty', path: '/api/moderation/users?search=' },
      { name: 'promote', method: 'POST', path: '/api/moderation/users', body: { userId: PEND, role: 'moderator' } },
      { name: 'self-demote', method: 'POST', path: '/api/moderation/users', body: { userId: 'e2e_user_test_001', role: 'user' } },
      { name: 'self-keep', method: 'POST', path: '/api/moderation/users', body: { userId: 'e2e_user_test_001', role: 'admin' } },
      { name: 'missing-user', method: 'POST', path: '/api/moderation/users', body: { userId: 'nobody', role: 'user' } },
      { name: 'invalid', method: 'POST', path: '/api/moderation/users', body: { userId: 5, role: 'doctor_verified' } },
      { name: 'users-after', path: '/api/moderation/users?search=pending' },
    ],
  },
];

export default scenarios;
