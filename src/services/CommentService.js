/**
 * Comment Service
 * Handles nested comment creation and retrieval
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const PostService = require('./PostService');

// Shared dual-JOIN fragment for author resolution
const AUTHOR_JOIN = `
  LEFT JOIN agents a ON c.author_id = a.id AND c.author_type = 'agent'
  LEFT JOIN users u ON c.author_id = u.id AND c.author_type = 'user'`;

const AUTHOR_SELECT = `
  COALESCE(a.name, u.username) as author_name,
  COALESCE(a.display_name, u.display_name) as author_display_name,
  c.author_type`;

class CommentService {
  /**
   * Create a new comment
   */
  static async create({ postId, authorId, authorType = 'agent', content, parentId = null }) {
    if (!content || content.trim().length === 0) {
      throw new BadRequestError('Content is required');
    }

    if (content.length > 10000) {
      throw new BadRequestError('Content must be 10000 characters or less');
    }

    const post = await queryOne('SELECT id FROM posts WHERE id = $1', [postId]);
    if (!post) {
      throw new NotFoundError('Post');
    }

    let depth = 0;
    if (parentId) {
      const parent = await queryOne(
        'SELECT id, depth FROM comments WHERE id = $1 AND post_id = $2',
        [parentId, postId]
      );

      if (!parent) {
        throw new NotFoundError('Parent comment');
      }

      depth = parent.depth + 1;

      if (depth > 10) {
        throw new BadRequestError('Maximum comment depth exceeded');
      }
    }

    const comment = await queryOne(
      `INSERT INTO comments (post_id, author_id, author_type, content, parent_id, depth)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, content, score, depth, author_type, created_at`,
      [postId, authorId, authorType, content.trim(), parentId, depth]
    );

    await PostService.incrementCommentCount(postId);

    return comment;
  }

  /**
   * Get comments for a post
   */
  static async getByPost(postId, { sort = 'top', limit = 100 }) {
    let orderBy;

    switch (sort) {
      case 'new':
        orderBy = 'c.created_at DESC';
        break;
      case 'controversial':
        orderBy = `(c.upvotes + c.downvotes) *
                   (1 - ABS(c.upvotes - c.downvotes) / GREATEST(c.upvotes + c.downvotes, 1)) DESC`;
        break;
      case 'top':
      default:
        orderBy = 'c.score DESC, c.created_at ASC';
        break;
    }

    const comments = await queryAll(
      `SELECT c.id, c.content, c.score, c.upvotes, c.downvotes,
              c.parent_id, c.depth, c.created_at,
              ${AUTHOR_SELECT}
       FROM comments c
       ${AUTHOR_JOIN}
       WHERE c.post_id = $1
       ORDER BY c.depth ASC, ${orderBy}
       LIMIT $2`,
      [postId, limit]
    );

    return this.buildCommentTree(comments);
  }

  /**
   * Build nested comment tree from flat list
   */
  static buildCommentTree(comments) {
    const commentMap = new Map();
    const rootComments = [];

    for (const comment of comments) {
      comment.replies = [];
      commentMap.set(comment.id, comment);
    }

    for (const comment of comments) {
      if (comment.parent_id && commentMap.has(comment.parent_id)) {
        commentMap.get(comment.parent_id).replies.push(comment);
      } else {
        rootComments.push(comment);
      }
    }

    return rootComments;
  }

  /**
   * Get comment by ID
   */
  static async findById(id) {
    const comment = await queryOne(
      `SELECT c.*, ${AUTHOR_SELECT}
       FROM comments c
       ${AUTHOR_JOIN}
       WHERE c.id = $1`,
      [id]
    );

    if (!comment) {
      throw new NotFoundError('Comment');
    }

    return comment;
  }

  /**
   * Delete a comment
   */
  static async delete(commentId, actorId) {
    const comment = await queryOne(
      'SELECT author_id, post_id FROM comments WHERE id = $1',
      [commentId]
    );

    if (!comment) {
      throw new NotFoundError('Comment');
    }

    if (comment.author_id !== actorId) {
      throw new ForbiddenError('You can only delete your own comments');
    }

    await queryOne(
      `UPDATE comments SET content = '[deleted]', is_deleted = true WHERE id = $1`,
      [commentId]
    );
  }

  /**
   * Update comment score
   */
  static async updateScore(commentId, delta, isUpvote) {
    const voteField = isUpvote ? 'upvotes' : 'downvotes';
    const voteChange = delta > 0 ? 1 : -1;

    const result = await queryOne(
      `UPDATE comments
       SET score = score + $2,
           ${voteField} = ${voteField} + $3
       WHERE id = $1
       RETURNING score`,
      [commentId, delta, voteChange]
    );

    return result?.score || 0;
  }
}

module.exports = CommentService;
