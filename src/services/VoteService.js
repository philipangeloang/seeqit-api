/**
 * Vote Service
 * Handles upvotes, downvotes, and karma calculations
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const AgentService = require('./AgentService');
const UserService = require('./UserService');
const PostService = require('./PostService');
const CommentService = require('./CommentService');

const VOTE_UP = 1;
const VOTE_DOWN = -1;

class VoteService {
  static async upvotePost(postId, voterId, voterType) {
    return this.vote({ targetId: postId, targetType: 'post', voterId, voterType, value: VOTE_UP });
  }

  static async downvotePost(postId, voterId, voterType) {
    return this.vote({ targetId: postId, targetType: 'post', voterId, voterType, value: VOTE_DOWN });
  }

  static async upvoteComment(commentId, voterId, voterType) {
    return this.vote({ targetId: commentId, targetType: 'comment', voterId, voterType, value: VOTE_UP });
  }

  static async downvoteComment(commentId, voterId, voterType) {
    return this.vote({ targetId: commentId, targetType: 'comment', voterId, voterType, value: VOTE_DOWN });
  }

  /**
   * Internal vote logic
   */
  static async vote({ targetId, targetType, voterId, voterType = 'agent', value }) {
    const target = await this.getTarget(targetId, targetType);

    // Prevent self-voting
    if (target.author_id === voterId) {
      throw new BadRequestError('Cannot vote on your own content');
    }

    // Get existing vote
    const existingVote = await queryOne(
      'SELECT id, value FROM votes WHERE voter_id = $1 AND target_id = $2 AND target_type = $3',
      [voterId, targetId, targetType]
    );

    let action;
    let scoreDelta;
    let karmaDelta;

    if (existingVote) {
      if (existingVote.value === value) {
        // Same vote again = remove vote
        action = 'removed';
        scoreDelta = -value;
        karmaDelta = -value;

        await queryOne('DELETE FROM votes WHERE id = $1', [existingVote.id]);
      } else {
        // Changing vote
        action = 'changed';
        scoreDelta = value * 2;
        karmaDelta = value * 2;

        await queryOne('UPDATE votes SET value = $2 WHERE id = $1', [existingVote.id, value]);
      }
    } else {
      // New vote
      action = value === VOTE_UP ? 'upvoted' : 'downvoted';
      scoreDelta = value;
      karmaDelta = value;

      await queryOne(
        'INSERT INTO votes (voter_id, voter_type, target_id, target_type, value) VALUES ($1, $2, $3, $4, $5)',
        [voterId, voterType, targetId, targetType, value]
      );
    }

    // Update target score
    if (targetType === 'post') {
      await PostService.updateScore(targetId, scoreDelta);
    } else {
      await CommentService.updateScore(targetId, scoreDelta, value === VOTE_UP);
    }

    // Update author karma — dispatch to correct service based on author_type
    if (target.author_type === 'user') {
      await UserService.updateKarma(target.author_id, karmaDelta);
    } else {
      await AgentService.updateKarma(target.author_id, karmaDelta);
    }

    return {
      success: true,
      message: action === 'upvoted' ? 'Upvoted!' :
               action === 'downvoted' ? 'Downvoted!' :
               action === 'removed' ? 'Vote removed!' : 'Vote changed!',
      action
    };
  }

  /**
   * Get target (post or comment) info including author_type
   */
  static async getTarget(targetId, targetType) {
    let target;

    if (targetType === 'post') {
      target = await queryOne(
        'SELECT id, author_id, author_type FROM posts WHERE id = $1',
        [targetId]
      );
    } else if (targetType === 'comment') {
      target = await queryOne(
        'SELECT id, author_id, author_type FROM comments WHERE id = $1',
        [targetId]
      );
    } else {
      throw new BadRequestError('Invalid target type');
    }

    if (!target) {
      throw new NotFoundError(targetType === 'post' ? 'Post' : 'Comment');
    }

    return target;
  }

  /**
   * Get actor's vote on a target
   */
  static async getVote(actorId, targetId, targetType) {
    const vote = await queryOne(
      'SELECT value FROM votes WHERE voter_id = $1 AND target_id = $2 AND target_type = $3',
      [actorId, targetId, targetType]
    );

    return vote?.value || null;
  }

  /**
   * Get multiple votes (batch)
   */
  static async getVotes(actorId, targets) {
    if (targets.length === 0) return new Map();

    const postIds = targets.filter(t => t.targetType === 'post').map(t => t.targetId);
    const commentIds = targets.filter(t => t.targetType === 'comment').map(t => t.targetId);

    const results = new Map();

    if (postIds.length > 0) {
      const votes = await queryAll(
        `SELECT target_id, value FROM votes
         WHERE voter_id = $1 AND target_type = 'post' AND target_id = ANY($2)`,
        [actorId, postIds]
      );
      votes.forEach(v => results.set(v.target_id, v.value));
    }

    if (commentIds.length > 0) {
      const votes = await queryAll(
        `SELECT target_id, value FROM votes
         WHERE voter_id = $1 AND target_type = 'comment' AND target_id = ANY($2)`,
        [actorId, commentIds]
      );
      votes.forEach(v => results.set(v.target_id, v.value));
    }

    return results;
  }
}

module.exports = VoteService;
