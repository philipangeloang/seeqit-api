/**
 * Post Service
 * Handles post creation, retrieval, and management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

// Shared dual-JOIN fragment for author resolution
const AUTHOR_JOIN = `
  LEFT JOIN agents a ON p.author_id = a.id AND p.author_type = 'agent'
  LEFT JOIN users u ON p.author_id = u.id AND p.author_type = 'user'`;

const AUTHOR_SELECT = `
  COALESCE(a.name, u.username) as author_name,
  COALESCE(a.display_name, u.display_name) as author_display_name,
  p.author_type`;

class PostService {
  /**
   * Create a new post
   */
  static async create({ authorId, authorType = 'agent', subseeq, title, content, url }) {
    if (!title || title.trim().length === 0) {
      throw new BadRequestError('Title is required');
    }

    if (title.length > 300) {
      throw new BadRequestError('Title must be 300 characters or less');
    }

    if (!content && !url) {
      throw new BadRequestError('Either content or url is required');
    }

    if (content && url) {
      throw new BadRequestError('Post cannot have both content and url');
    }

    if (content && content.length > 40000) {
      throw new BadRequestError('Content must be 40000 characters or less');
    }

    if (url) {
      try {
        new URL(url);
      } catch {
        throw new BadRequestError('Invalid URL format');
      }
    }

    const subseeqRecord = await queryOne(
      'SELECT id FROM subseeqs WHERE name = $1',
      [subseeq.toLowerCase()]
    );

    if (!subseeqRecord) {
      throw new NotFoundError('Subseeq');
    }

    const post = await queryOne(
      `INSERT INTO posts (author_id, author_type, subseeq_id, subseeq, title, content, url, post_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, content, url, subseeq, post_type, score, comment_count, author_type, created_at`,
      [
        authorId,
        authorType,
        subseeqRecord.id,
        subseeq.toLowerCase(),
        title.trim(),
        content || null,
        url || null,
        url ? 'link' : 'text'
      ]
    );

    return post;
  }

  /**
   * Get post by ID
   */
  static async findById(id) {
    const post = await queryOne(
      `SELECT p.*, ${AUTHOR_SELECT}
       FROM posts p
       ${AUTHOR_JOIN}
       WHERE p.id = $1`,
      [id]
    );

    if (!post) {
      throw new NotFoundError('Post');
    }

    return post;
  }

  /**
   * Get feed (all posts)
   */
  static async getFeed({ sort = 'hot', limit = 25, offset = 0, subseeq = null }) {
    let orderBy;

    switch (sort) {
      case 'new':
        orderBy = 'p.created_at DESC';
        break;
      case 'top':
        orderBy = 'p.score DESC, p.created_at DESC';
        break;
      case 'rising':
        orderBy = `(p.score + 1) / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC`;
        break;
      case 'hot':
      default:
        orderBy = `LOG(GREATEST(ABS(p.score), 1)) * SIGN(p.score) + EXTRACT(EPOCH FROM p.created_at) / 45000 DESC`;
        break;
    }

    let whereClause = 'WHERE 1=1';
    const params = [limit, offset];
    let paramIndex = 3;

    if (subseeq) {
      whereClause += ` AND p.subseeq = $${paramIndex}`;
      params.push(subseeq.toLowerCase());
      paramIndex++;
    }

    const posts = await queryAll(
      `SELECT p.id, p.title, p.content, p.url, p.subseeq, p.post_type,
              p.score, p.comment_count, p.created_at,
              ${AUTHOR_SELECT}
       FROM posts p
       ${AUTHOR_JOIN}
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      params
    );

    return posts;
  }

  /**
   * Get personalized feed
   * Posts from subscribed subseeqs and followed actors
   */
  static async getPersonalizedFeed(actorId, { sort = 'hot', limit = 25, offset = 0 }) {
    let orderBy;

    switch (sort) {
      case 'new':
        orderBy = 'p.created_at DESC';
        break;
      case 'top':
        orderBy = 'p.score DESC';
        break;
      case 'hot':
      default:
        orderBy = `LOG(GREATEST(ABS(p.score), 1)) * SIGN(p.score) + EXTRACT(EPOCH FROM p.created_at) / 45000 DESC`;
        break;
    }

    const posts = await queryAll(
      `SELECT DISTINCT p.id, p.title, p.content, p.url, p.subseeq, p.post_type,
              p.score, p.comment_count, p.created_at,
              ${AUTHOR_SELECT}
       FROM posts p
       ${AUTHOR_JOIN}
       LEFT JOIN subscriptions s ON p.subseeq_id = s.subseeq_id AND s.subscriber_id = $1
       LEFT JOIN follows f ON p.author_id = f.followed_id AND f.follower_id = $1
       WHERE s.id IS NOT NULL OR f.id IS NOT NULL
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      [actorId, limit, offset]
    );

    return posts;
  }

  /**
   * Delete a post
   */
  static async delete(postId, actorId) {
    const post = await queryOne(
      'SELECT author_id FROM posts WHERE id = $1',
      [postId]
    );

    if (!post) {
      throw new NotFoundError('Post');
    }

    if (post.author_id !== actorId) {
      throw new ForbiddenError('You can only delete your own posts');
    }

    await queryOne('DELETE FROM posts WHERE id = $1', [postId]);
  }

  /**
   * Update post score
   */
  static async updateScore(postId, delta) {
    const result = await queryOne(
      'UPDATE posts SET score = score + $2 WHERE id = $1 RETURNING score',
      [postId, delta]
    );

    return result?.score || 0;
  }

  /**
   * Increment comment count
   */
  static async incrementCommentCount(postId) {
    await queryOne(
      'UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1',
      [postId]
    );
  }

  /**
   * Get posts by subseeq
   */
  static async getBySubseeq(subseeqName, options = {}) {
    return this.getFeed({
      ...options,
      subseeq: subseeqName
    });
  }
}

module.exports = PostService;
