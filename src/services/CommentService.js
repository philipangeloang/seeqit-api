/**
 * Comment Service
 * Handles nested comment creation and retrieval
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const PostService = require('./PostService');

const AUTHOR_JOIN = `
  LEFT JOIN agents a ON c.author_id = a.id AND c.author_type = 'agent'
  LEFT JOIN users u ON c.author_id = u.id AND c.author_type = 'user'`;

const AUTHOR_SELECT = `
  COALESCE(a.name, u.username) as author_name,
  COALESCE(a.display_name, u.display_name) as author_display_name,
  c.author_type`;

class CommentService {
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
       RETURNING id, content, score, energy, depth, author_type, created_at`,
      [postId, authorId, authorType, content.trim(), parentId, depth]
    );

    await PostService.incrementCommentCount(postId);

    return comment;
  }

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
        orderBy = 'c.energy DESC, c.created_at ASC';
        break;
    }

    const comments = await queryAll(
      `SELECT c.id, c.content, c.score, c.energy, c.upvotes, c.downvotes,
              c.parent_id, c.depth, c.created_at,
              ${AUTHOR_SELECT}
       FROM comments c
       ${AUTHOR_JOIN}
       WHERE c.post_id = $1 AND c.is_deleted = false
       ORDER BY c.depth ASC, ${orderBy}
       LIMIT $2`,
      [postId, limit]
    );

    return this.buildCommentTree(comments);
  }

  /**
   * Flat list for vote enrichment
   */
  static flattenCommentTree(comments) {
    const flat = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        flat.push(node);
        if (node.replies?.length) walk(node.replies);
      }
    };
    walk(comments);
    return flat;
  }

  static attachVotesToTree(comments, voteMap) {
    const attach = (nodes) =>
      nodes.map(c => ({
        ...c,
        userVote: voteMap.get(c.id) ?? c.userVote,
        replies: c.replies?.length ? attach(c.replies) : []
      }));
    return attach(comments);
  }

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

  static async updateVoteStats(client, commentId, { scoreDelta, energyDelta, upDelta, downDelta }) {
    const result = await client.query(
      `UPDATE comments
       SET score = score + $2,
           energy = energy + $3,
           upvotes = GREATEST(0, upvotes + $4),
           downvotes = GREATEST(0, downvotes + $5),
           updated_at = NOW()
       WHERE id = $1
       RETURNING score, energy, upvotes, downvotes`,
      [commentId, scoreDelta, energyDelta, upDelta, downDelta]
    );

    return result.rows[0];
  }

  /** @deprecated use updateVoteStats */
  static async updateScore(commentId, delta, isUpvote) {
    const voteField = isUpvote ? 'upvotes' : 'downvotes';
    const voteChange = delta > 0 ? 1 : -1;

    const result = await queryOne(
      `UPDATE comments
       SET score = score + $2,
           energy = energy + $2,
           ${voteField} = ${voteField} + $3
       WHERE id = $1
       RETURNING score, energy`,
      [commentId, delta, voteChange]
    );

    return result?.score || 0;
  }
}

module.exports = CommentService;
