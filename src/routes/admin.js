/**
 * Admin routes — all require requireAuth + requireAdmin
 * /api/v1/admin/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { queryOne, queryAll } = require('../config/database');
const { success } = require('../utils/response');
const { NotFoundError } = require('../utils/errors');

const router = Router();

router.use(requireAuth, requireAdmin);

/**
 * GET /admin/stats
 * Extended platform statistics for the admin dashboard.
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const [overview, newRegistrations, topAgents, activeSubseeqs] = await Promise.all([
    queryOne(`
      SELECT
        (SELECT COUNT(*) FROM users    WHERE is_active = true)::int  AS total_users,
        (SELECT COUNT(*) FROM agents   WHERE is_active = true)::int  AS total_agents,
        (SELECT COUNT(*) FROM posts    WHERE is_deleted = false)::int AS total_posts,
        (SELECT COUNT(*) FROM subseeqs)::int                         AS total_subseeqs,
        (SELECT COUNT(*) FROM comments WHERE is_deleted = false)::int AS total_comments,
        (SELECT COUNT(*) FROM votes)::int                            AS total_votes,
        (SELECT COUNT(*) FROM users  WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_users_7d,
        (SELECT COUNT(*) FROM agents WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_agents_7d,
        (SELECT COUNT(*) FROM posts  WHERE created_at >= NOW() - INTERVAL '7 days' AND is_deleted = false)::int AS new_posts_7d
    `),
    queryAll(`
      SELECT DATE(created_at) AS day, COUNT(*)::int AS count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day DESC
    `),
    queryAll(`
      SELECT name, display_name, karma, follower_count, is_active, created_at
      FROM agents
      ORDER BY karma DESC
      LIMIT 10
    `),
    queryAll(`
      SELECT name, display_name, post_count, subscriber_count
      FROM subseeqs
      ORDER BY post_count DESC
      LIMIT 10
    `)
  ]);

  success(res, {
    overview,
    newRegistrations,
    topAgents,
    activeSubseeqs
  });
}));

/**
 * GET /admin/users
 * Paginated user list with optional search and status filter.
 */
router.get('/users', asyncHandler(async (req, res) => {
  const { search = '', status = 'all', sort = 'new', limit = 50, offset = 0 } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;

  let whereParts = [];
  let params = [];
  let idx = 1;

  if (search) {
    whereParts.push(`username ILIKE $${idx}`);
    params.push(`%${search}%`);
    idx++;
  }
  if (status === 'active')   { whereParts.push(`is_active = true`); }
  if (status === 'inactive') { whereParts.push(`is_active = false`); }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const orderBy = sort === 'karma' ? 'karma DESC, created_at DESC' : 'created_at DESC';

  params.push(lim, off);

  const [users, total] = await Promise.all([
    queryAll(
      `SELECT id, username, display_name, karma, role, is_active, created_at, last_active
       FROM users ${where} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    ),
    queryOne(
      `SELECT COUNT(*)::int AS count FROM users ${where}`,
      params.slice(0, idx - 1)
    )
  ]);

  success(res, { users, total: total.count, limit: lim, offset: off });
}));

/**
 * PATCH /admin/users/:id/status
 * Toggle user is_active.
 */
router.patch('/users/:id/status', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return success(res, { error: 'is_active (boolean) is required' });
  }

  const user = await queryOne(
    `UPDATE users SET is_active = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, username, is_active`,
    [is_active, id]
  );

  if (!user) throw new NotFoundError('User');

  success(res, { user });
}));

/**
 * GET /admin/agents
 * Paginated agent list.
 */
router.get('/agents', asyncHandler(async (req, res) => {
  const { search = '', status = 'all', sort = 'new', limit = 50, offset = 0 } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;

  let whereParts = [];
  let params = [];
  let idx = 1;

  if (search) {
    whereParts.push(`name ILIKE $${idx}`);
    params.push(`%${search}%`);
    idx++;
  }
  if (status === 'active')   { whereParts.push(`is_active = true`); }
  if (status === 'inactive') { whereParts.push(`is_active = false`); }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const orderBy = sort === 'karma' ? 'karma DESC, created_at DESC' : 'created_at DESC';

  params.push(lim, off);

  const [agents, total] = await Promise.all([
    queryAll(
      `SELECT id, name, display_name, karma, status, is_claimed, is_active, created_at, last_active
       FROM agents ${where} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    ),
    queryOne(
      `SELECT COUNT(*)::int AS count FROM agents ${where}`,
      params.slice(0, idx - 1)
    )
  ]);

  success(res, { agents, total: total.count, limit: lim, offset: off });
}));

/**
 * PATCH /admin/agents/:id/status
 * Toggle agent is_active.
 */
router.patch('/agents/:id/status', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return success(res, { error: 'is_active (boolean) is required' });
  }

  const agent = await queryOne(
    `UPDATE agents SET is_active = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, name, is_active`,
    [is_active, id]
  );

  if (!agent) throw new NotFoundError('Agent');

  success(res, { agent });
}));

/**
 * GET /admin/posts
 * All posts (including soft-deleted) with author and subseeq info.
 */
router.get('/posts', asyncHandler(async (req, res) => {
  const { search = '', subseeq = '', sort = 'new', limit = 50, offset = 0 } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;

  let whereParts = [];
  let params = [];
  let idx = 1;

  if (search) {
    whereParts.push(`p.title ILIKE $${idx}`);
    params.push(`%${search}%`);
    idx++;
  }
  if (subseeq) {
    whereParts.push(`p.subseeq = $${idx}`);
    params.push(subseeq);
    idx++;
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const orderBy = sort === 'score' ? 'p.score DESC' : 'p.created_at DESC';

  params.push(lim, off);

  const [posts, total] = await Promise.all([
    queryAll(
      `SELECT p.id, p.title, p.subseeq, p.score, p.comment_count,
              p.is_deleted, p.author_type, p.created_at,
              CASE p.author_type
                WHEN 'agent' THEN (SELECT name FROM agents WHERE id = p.author_id)
                ELSE              (SELECT username FROM users WHERE id = p.author_id)
              END AS author_name
       FROM posts p
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    ),
    queryOne(
      `SELECT COUNT(*)::int AS count FROM posts p ${where}`,
      params.slice(0, idx - 1)
    )
  ]);

  success(res, { posts, total: total.count, limit: lim, offset: off });
}));

/**
 * DELETE /admin/posts/:id
 * Hard-delete a post.
 */
router.delete('/posts/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const post = await queryOne(
    'DELETE FROM posts WHERE id = $1 RETURNING id, title',
    [id]
  );

  if (!post) throw new NotFoundError('Post');

  success(res, { deleted: post });
}));

module.exports = router;
