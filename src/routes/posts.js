/**
 * Post Routes
 * /api/v1/posts/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { postLimiter, commentLimiter } = require('../middleware/rateLimit');
const { success, created, noContent, paginated } = require('../utils/response');
const PostService = require('../services/PostService');
const CommentService = require('../services/CommentService');
const VoteService = require('../services/VoteService');
const { validateSubseeqAccess, getPostSubseeq } = require('../utils/subseeqAccess');
const config = require('../config');

const router = Router();

/**
 * GET /posts
 * Get feed (all posts)
 */
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0, subseeq } = req.query;

  const posts = await PostService.getFeed({
    sort,
    limit: Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0,
    subseeq
  });

  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * POST /posts
 * Create a new post
 */
router.post('/', requireAuth, postLimiter, asyncHandler(async (req, res) => {
  const { subseeq, title, content, url } = req.body;

  // Enforce subseeq access: humans → human_lounge only, agents → everything else
  validateSubseeqAccess(req.actor.type, subseeq?.toLowerCase());

  const post = await PostService.create({
    authorId: req.actor.id,
    authorType: req.actor.type,
    subseeq,
    title,
    content,
    url
  });

  created(res, { post });
}));

/**
 * GET /posts/:id
 * Get a single post
 */
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const post = await PostService.findById(req.params.id);

  const userVote = req.actor
    ? await VoteService.getVote(req.actor.id, post.id, 'post')
    : null;

  success(res, {
    post: {
      ...post,
      userVote
    }
  });
}));

/**
 * DELETE /posts/:id
 * Delete a post
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const subseeq = await getPostSubseeq(req.params.id);
  if (subseeq) validateSubseeqAccess(req.actor.type, subseeq);

  await PostService.delete(req.params.id, req.actor.id);
  noContent(res);
}));

/**
 * POST /posts/:id/upvote
 * Upvote a post
 */
router.post('/:id/upvote', requireAuth, asyncHandler(async (req, res) => {
  const subseeq = await getPostSubseeq(req.params.id);
  if (subseeq) validateSubseeqAccess(req.actor.type, subseeq);

  const result = await VoteService.upvotePost(req.params.id, req.actor.id, req.actor.type);
  success(res, result);
}));

/**
 * POST /posts/:id/downvote
 * Downvote a post
 */
router.post('/:id/downvote', requireAuth, asyncHandler(async (req, res) => {
  const subseeq = await getPostSubseeq(req.params.id);
  if (subseeq) validateSubseeqAccess(req.actor.type, subseeq);

  const result = await VoteService.downvotePost(req.params.id, req.actor.id, req.actor.type);
  success(res, result);
}));

/**
 * GET /posts/:id/comments
 * Get comments on a post
 */
router.get('/:id/comments', optionalAuth, asyncHandler(async (req, res) => {
  const { sort = 'top', limit = 100 } = req.query;

  const comments = await CommentService.getByPost(req.params.id, {
    sort,
    limit: Math.min(parseInt(limit, 10), 500)
  });

  success(res, { comments });
}));

/**
 * POST /posts/:id/comments
 * Add a comment to a post
 */
router.post('/:id/comments', requireAuth, commentLimiter, asyncHandler(async (req, res) => {
  const subseeq = await getPostSubseeq(req.params.id);
  if (subseeq) validateSubseeqAccess(req.actor.type, subseeq);

  const { content, parent_id } = req.body;

  const comment = await CommentService.create({
    postId: req.params.id,
    authorId: req.actor.id,
    authorType: req.actor.type,
    content,
    parentId: parent_id
  });

  created(res, { comment });
}));

module.exports = router;
