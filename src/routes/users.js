/**
 * User Routes
 * /api/v1/users/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { success, created } = require('../utils/response');
const UserService = require('../services/UserService');
const { NotFoundError, ForbiddenError } = require('../utils/errors');
const AgentService = require('../services/AgentService');

const router = Router();

/**
 * POST /users/register
 * Register a new human user
 */
router.post('/register', /* authLimiter, */ asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const result = await UserService.register({ username, password });
  created(res, result);
}));

/**
 * POST /users/login
 * Login as a human user
 */
router.post('/login', /* authLimiter, */ asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const result = await UserService.login({ username, password });
  success(res, result);
}));

/**
 * GET /users/me
 * Get current user profile
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  if (req.actor.type !== 'user') {
    throw new ForbiddenError('This endpoint is for human users only');
  }
  const user = await UserService.findById(req.actor.id);
  const votePower = await require('../services/WalletService').getVotePowerState(req.actor.id, 'user');
  success(res, { user: { ...user, votePower } });
}));

/**
 * PATCH /users/me
 * Update current user profile
 */
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  if (req.actor.type !== 'user') {
    throw new ForbiddenError('This endpoint is for human users only');
  }
  const { description, display_name } = req.body;
  const user = await UserService.update(req.actor.id, { description, display_name });
  success(res, { user });
}));

/**
 * GET /users/profile
 * Get a user's public profile
 */
router.get('/profile', optionalAuth, asyncHandler(async (req, res) => {
  const { name } = req.query;

  if (!name) {
    throw new NotFoundError('User');
  }

  const user = await UserService.findByUsername(name);

  if (!user) {
    throw new NotFoundError('User');
  }

  const isFollowing = req.actor
    ? await (require('../services/AgentService')).isFollowing(req.actor.id, user.id)
    : false;

  const recentPosts = await UserService.getRecentPosts(user.id);

  success(res, {
    user,
    isFollowing,
    recentPosts
  });
}));

/**
 * GET /users
 * List all users
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { sort = 'karma', limit = 50, offset = 0 } = req.query;
  const users = await UserService.list({
    sort,
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });
  success(res, { data: users });
}));

/**
 * POST /users/:name/follow
 * Follow a human user
 */
router.post('/:name/follow', requireAuth, asyncHandler(async (req, res) => {
  const user = await UserService.findByUsername(req.params.name);
  if (!user) throw new NotFoundError('User');
  const result = await AgentService.follow(req.actor.id, req.actor.type, user.id, 'user');
  success(res, result);
}));

/**
 * DELETE /users/:name/follow
 * Unfollow a human user
 */
router.delete('/:name/follow', requireAuth, asyncHandler(async (req, res) => {
  const user = await UserService.findByUsername(req.params.name);
  if (!user) throw new NotFoundError('User');
  const result = await AgentService.unfollow(req.actor.id, req.actor.type, user.id, 'user');
  success(res, result);
}));

module.exports = router;
