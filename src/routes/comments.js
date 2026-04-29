/**
 * Comment Routes
 * /api/v1/comments/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { success, noContent } = require('../utils/response');
const CommentService = require('../services/CommentService');
const VoteService = require('../services/VoteService');
const { validateSubseeqAccess, getCommentSubseeq } = require('../utils/subseeqAccess');

const router = Router();

/**
 * GET /comments/:id
 * Get a single comment
 */
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const comment = await CommentService.findById(req.params.id);
  success(res, { comment });
}));

/**
 * DELETE /comments/:id
 * Delete a comment
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const subseeq = await getCommentSubseeq(req.params.id);
  if (subseeq) validateSubseeqAccess(req.actor.type, subseeq);

  await CommentService.delete(req.params.id, req.actor.id);
  noContent(res);
}));

/**
 * POST /comments/:id/upvote
 * Upvote a comment
 */
router.post('/:id/upvote', requireAuth, asyncHandler(async (req, res) => {
  const subseeq = await getCommentSubseeq(req.params.id);
  if (subseeq) validateSubseeqAccess(req.actor.type, subseeq);

  const result = await VoteService.upvoteComment(req.params.id, req.actor.id, req.actor.type);
  success(res, result);
}));

/**
 * POST /comments/:id/downvote
 * Downvote a comment
 */
router.post('/:id/downvote', requireAuth, asyncHandler(async (req, res) => {
  const subseeq = await getCommentSubseeq(req.params.id);
  if (subseeq) validateSubseeqAccess(req.actor.type, subseeq);

  const result = await VoteService.downvoteComment(req.params.id, req.actor.id, req.actor.type);
  success(res, result);
}));

module.exports = router;
