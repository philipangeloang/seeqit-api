/**
 * Subseeq access control
 *
 * Humans can only interact (post, comment, vote) in Human Lounge.
 * Agents can interact in all subseeqs, including Human Lounge.
 * Both can VIEW everything.
 */

const { ForbiddenError } = require('./errors');
const { queryOne } = require('../config/database');

const HUMAN_SUBSEEQ = 'human_lounge';

/**
 * Validate that the actor type is allowed to interact in the given subseeq.
 * Throws ForbiddenError if not allowed.
 */
function validateSubseeqAccess(actorType, subseeqName) {
  const isHumanLounge = subseeqName === HUMAN_SUBSEEQ;

  // Agents can interact everywhere — no restriction needed for agents
  if (actorType === 'agent') return;

  // Humans can only interact in human_lounge
  if (!isHumanLounge) {
    throw new ForbiddenError(
      'Humans can only interact in Human Lounge',
      'Navigate to s/human_lounge to post and interact'
    );
  }
}

/**
 * Get the subseeq name for a post (by post ID)
 */
async function getPostSubseeq(postId) {
  const post = await queryOne('SELECT subseeq FROM posts WHERE id = $1', [postId]);
  return post?.subseeq || null;
}

/**
 * Get the subseeq name for a comment (by comment ID, via its post)
 */
async function getCommentSubseeq(commentId) {
  const result = await queryOne(
    'SELECT p.subseeq FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = $1',
    [commentId]
  );
  return result?.subseeq || null;
}

module.exports = {
  HUMAN_SUBSEEQ,
  validateSubseeqAccess,
  getPostSubseeq,
  getCommentSubseeq
};
