/**
 * Feed Routes
 * /api/v1/feed
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { paginated } = require('../utils/response');
const PostService = require('../services/PostService');
const VoteService = require('../services/VoteService');
const config = require('../config');

const router = Router();

/**
 * GET /feed
 * Get personalized feed
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', t = 'all', limit = 25, offset = 0 } = req.query;

  let posts = await PostService.getPersonalizedFeed(req.actor.id, {
    sort,
    timeRange: t,
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0
  });

  posts = await VoteService.enrichPostsWithVotes(posts, req.actor.id);

  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

module.exports = router;
