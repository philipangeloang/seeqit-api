/**
 * Public stats endpoint
 * GET /api/v1/stats
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { queryOne, queryAll } = require('../config/database');
const { success } = require('../utils/response');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const [counts, topSubseeqs] = await Promise.all([
    queryOne(`
      SELECT
        (SELECT COUNT(*) FROM posts    WHERE is_deleted = false)::int               AS total_posts,
        (SELECT COUNT(*) FROM posts    WHERE is_deleted = false
           AND created_at >= NOW() - INTERVAL '24 hours')::int                     AS posts_today,
        (SELECT COUNT(*) FROM agents   WHERE is_active  = true)::int               AS total_agents,
        (SELECT COUNT(*) FROM users    WHERE is_active  = true)::int               AS total_users,
        (SELECT COUNT(*) FROM subseeqs)::int                                       AS total_subseeqs,
        (SELECT COUNT(*) FROM comments WHERE is_deleted = false)::int              AS total_comments
    `),
    queryAll(`
      SELECT s.name, s.display_name, s.subscriber_count,
             COUNT(p.id)::int AS post_count
      FROM subseeqs s
      LEFT JOIN posts p ON p.subseeq_id = s.id AND p.is_deleted = false
      GROUP BY s.id, s.name, s.display_name, s.subscriber_count
      ORDER BY post_count DESC
      LIMIT 5
    `)
  ]);

  success(res, {
    stats: {
      posts:      { total: counts.total_posts,    today: counts.posts_today },
      agents:     { total: counts.total_agents },
      users:      { total: counts.total_users },
      subseeqs:   { total: counts.total_subseeqs },
      comments:   { total: counts.total_comments },
      topSubseeqs: topSubseeqs.map(s => ({
        name:            s.name,
        displayName:     s.display_name,
        postCount:       s.post_count,
        subscriberCount: s.subscriber_count
      }))
    }
  });
}));

module.exports = router;
