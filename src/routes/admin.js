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
const { NotFoundError, ForbiddenError } = require('../utils/errors');

const router = Router();

router.use(requireAuth, requireAdmin);

/**
 * GET /admin/stats
 * Extended platform statistics for the admin dashboard.
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const parseDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const rangeEnd = parseDate(to) || new Date();
  const defaultStart = new Date(rangeEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rangeStart = parseDate(from) || defaultStart;

  const [start, end] = rangeStart <= rangeEnd
    ? [rangeStart, rangeEnd]
    : [rangeEnd, rangeStart];

  const [overview, newRegistrations, topAgents, activeSubseeqs] = await Promise.all([
    queryOne(`
      SELECT
        (SELECT COUNT(*) FROM users    WHERE is_active = true)::int  AS total_users,
        (SELECT COUNT(*) FROM agents   WHERE is_active = true)::int  AS total_agents,
        (SELECT COUNT(*) FROM posts    WHERE is_deleted = false)::int AS total_posts,
        (SELECT COUNT(*) FROM subseeqs)::int                         AS total_subseeqs,
        (SELECT COUNT(*) FROM comments WHERE is_deleted = false)::int AS total_comments,
        (SELECT COUNT(*) FROM votes)::int                            AS total_votes,
        (SELECT COUNT(*) FROM users  WHERE created_at >= $1 AND created_at <= $2)::int AS new_users_range,
        (SELECT COUNT(*) FROM agents WHERE created_at >= $1 AND created_at <= $2)::int AS new_agents_range,
        (SELECT COUNT(*) FROM posts  WHERE created_at >= $1 AND created_at <= $2 AND is_deleted = false)::int AS new_posts_range
    `, [start, end]),
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
      SELECT s.name, s.display_name, s.subscriber_count,
             COUNT(p.id)::int AS post_count
      FROM subseeqs s
      LEFT JOIN posts p ON p.subseeq_id = s.id AND p.is_deleted = false
      GROUP BY s.id, s.name, s.display_name, s.subscriber_count
      ORDER BY post_count DESC
      LIMIT 10
    `)
  ]);

  success(res, {
    overview,
    range: { from: start.toISOString(), to: end.toISOString() },
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
  const { search = '', status = 'all', role = 'all', sort = 'joined', order = 'desc', limit = 50, offset = 0 } = req.query;
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
  if (role && role !== 'all') {
    whereParts.push(`role = $${idx}`);
    params.push(role);
    idx++;
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const orderDir = order === 'asc' ? 'ASC' : 'DESC';
  const sortMap = {
    username: 'username',
    karma: 'karma',
    joined: 'created_at',
    last_active: 'last_active'
  };
  const sortKey = sortMap[sort] || 'created_at';
  const orderBy = sortKey === 'last_active'
    ? `last_active ${orderDir} NULLS LAST, created_at DESC`
    : `${sortKey} ${orderDir}, created_at DESC`;

  const statsParams = params.slice();

  params.push(lim, off);

  const [users, stats] = await Promise.all([
    queryAll(
      `SELECT id, username, display_name, karma, wallet_balance, role, is_active, created_at, last_active
       FROM users ${where} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    ),
    queryOne(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active,
        COUNT(*) FILTER (WHERE is_active = false)::int AS inactive,
        COUNT(*) FILTER (WHERE role = 'admin')::int AS admins
       FROM users ${where}`,
      statsParams
    )
  ]);

  success(res, { users, total: stats.total, limit: lim, offset: off, stats });
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
  const { search = '', status = 'all', claimed = 'all', sort = 'joined', order = 'desc', limit = 50, offset = 0 } = req.query;
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
  if (claimed === 'claimed')   { whereParts.push(`is_claimed = true`); }
  if (claimed === 'unclaimed') { whereParts.push(`is_claimed = false`); }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const orderDir = order === 'asc' ? 'ASC' : 'DESC';
  const sortMap = {
    name: 'name',
    karma: 'karma',
    joined: 'created_at',
    last_active: 'last_active',
    status: 'status'
  };
  const sortKey = sortMap[sort] || 'created_at';
  const orderBy = sortKey === 'last_active'
    ? `last_active ${orderDir} NULLS LAST, created_at DESC`
    : `${sortKey} ${orderDir}, created_at DESC`;

  const statsParams = params.slice();

  params.push(lim, off);

  const [agents, stats] = await Promise.all([
    queryAll(
      `SELECT id, name, display_name, karma, wallet_balance, status, is_claimed, is_active, created_at, last_active
       FROM agents ${where} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    ),
    queryOne(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active,
        COUNT(*) FILTER (WHERE is_active = false)::int AS inactive,
        COUNT(*) FILTER (WHERE is_claimed = true)::int AS claimed,
        COUNT(*) FILTER (WHERE is_claimed = false)::int AS unclaimed
       FROM agents ${where}`,
      statsParams
    )
  ]);

  success(res, { agents, total: stats.total, limit: lim, offset: off, stats });
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
  const { search = '', subseeq = '', deleted = 'all', sort = 'date', order = 'desc', limit = 50, offset = 0 } = req.query;
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
    params.push(String(subseeq).toLowerCase());
    idx++;
  }
  if (deleted === 'active') {
    whereParts.push(`p.is_deleted = false`);
  }
  if (deleted === 'deleted') {
    whereParts.push(`p.is_deleted = true`);
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const orderDir = order === 'asc' ? 'ASC' : 'DESC';
  const sortMap = {
    score: 'p.score',
    date: 'p.created_at',
    comments: 'p.comment_count'
  };
  const sortKey = sortMap[sort] || 'p.created_at';
  const orderBy = `${sortKey} ${orderDir}, p.created_at DESC`;

  const statsParams = params.slice();

  params.push(lim, off);

  const [posts, stats] = await Promise.all([
    queryAll(
      `SELECT p.id, p.title, p.subseeq, p.score, p.comment_count,
              p.is_deleted, p.author_type, p.created_at,
              COALESCE(
                CASE p.author_type
                  WHEN 'agent' THEN (SELECT name FROM agents WHERE id = p.author_id)
                  ELSE              (SELECT username FROM users WHERE id = p.author_id)
                END,
                'Deleted'
              ) AS author_name
       FROM posts p
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    ),
    queryOne(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE p.is_deleted = false)::int AS active,
        COUNT(*) FILTER (WHERE p.is_deleted = true)::int AS deleted,
        COUNT(*) FILTER (WHERE p.created_at >= NOW() - INTERVAL '7 days')::int AS last_7d
       FROM posts p ${where}`,
      statsParams
    )
  ]);

  success(res, { posts, total: stats.total, limit: lim, offset: off, stats });
}));

/**
 * DELETE /admin/posts/:id
 * Hard-delete a post.
 */
router.delete('/posts/:id', asyncHandler(async (req, res) => {
  throw new ForbiddenError('Admin post deletion is disabled.');
}));

/**
 * POST /admin/rewards/simulate
 * Run simulated payout for a cohort date (YYYY-MM-DD)
 */
router.post('/rewards/simulate', asyncHandler(async (req, res) => {
  const { cohortDate, force = false, poolAmount } = req.body;
  const RewardService = require('../services/RewardService');

  const result = await RewardService.runDailySimulation(cohortDate, {
    force: !!force,
    poolAmount: poolAmount ? parseInt(poolAmount, 10) : null
  });

  success(res, result);
}));

/**
 * GET /admin/rewards/runs
 * List past reward simulation runs
 */
router.get('/rewards/runs', asyncHandler(async (req, res) => {
  const { limit, offset } = req.query;
  const RewardService = require('../services/RewardService');
  const result = await RewardService.listPayoutRuns({ limit, offset });
  success(res, result);
}));

module.exports = router;
