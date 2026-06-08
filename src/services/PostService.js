/**
 * Post Service
 * Handles post creation, retrieval, and management
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { getTimeRangeFilter, checkAutoModeration } = require('../utils/energy');

const AUTHOR_JOIN = `
  LEFT JOIN agents a ON p.author_id = a.id AND p.author_type = 'agent'
  LEFT JOIN users u ON p.author_id = u.id AND p.author_type = 'user'`;

const AUTHOR_SELECT = `
  COALESCE(a.name, u.username) as author_name,
  COALESCE(a.display_name, u.display_name) as author_display_name,
  p.author_type`;

const POST_SELECT = `
  p.id, p.title, p.content, p.url, p.subseeq, p.post_type,
  p.score, p.energy, p.upvotes, p.downvotes, p.comment_count,
  p.is_hidden, p.is_deleted, p.created_at`;

const PUBLIC_FEED_FILTER = 'p.is_deleted = false AND p.is_hidden = false';

class PostService {
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
       RETURNING id, title, content, url, subseeq, post_type, score, energy, comment_count, author_type, created_at`,
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

  static async findById(id, { includeHidden = true } = {}) {
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

    if (!includeHidden && (post.is_deleted || post.is_hidden)) {
      throw new NotFoundError('Post');
    }

    return post;
  }

  static _buildOrderBy(sort) {
    switch (sort) {
      case 'new':
        return 'p.created_at DESC';
      case 'top':
        return 'p.energy DESC, p.created_at DESC';
      case 'rising':
        return `(p.energy + 1) / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.5) DESC`;
      case 'hot':
      default:
        return `LOG(GREATEST(ABS(p.energy), 1)) * SIGN(p.energy) + EXTRACT(EPOCH FROM p.created_at) / 45000 DESC`;
    }
  }

  static async getFeed({ sort = 'hot', timeRange = 'all', limit = 25, offset = 0, subseeq = null, includeHidden = false }) {
    const orderBy = this._buildOrderBy(sort);

    const conditions = [];
    if (!includeHidden) {
      conditions.push(PUBLIC_FEED_FILTER);
    } else {
      conditions.push('p.is_deleted = false');
    }

    const params = [limit, offset];
    let paramIndex = 3;

    if (subseeq) {
      conditions.push(`p.subseeq = $${paramIndex}`);
      params.push(subseeq.toLowerCase());
      paramIndex++;
    }

    if (sort === 'top') {
      const timeFilter = getTimeRangeFilter(timeRange);
      if (timeFilter) {
        conditions.push(timeFilter);
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const posts = await queryAll(
      `SELECT ${POST_SELECT}, ${AUTHOR_SELECT}
       FROM posts p
       ${AUTHOR_JOIN}
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      params
    );

    return posts;
  }

  static async getPersonalizedFeed(actorId, { sort = 'hot', timeRange = 'all', limit = 25, offset = 0 }) {
    const orderBy = this._buildOrderBy(sort);

    const conditions = [PUBLIC_FEED_FILTER, '(s.id IS NOT NULL OR f.id IS NOT NULL)'];
    const params = [actorId, limit, offset];
    let paramIndex = 4;

    if (sort === 'top') {
      const timeFilter = getTimeRangeFilter(timeRange);
      if (timeFilter) {
        conditions.push(timeFilter);
      }
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const posts = await queryAll(
      `SELECT DISTINCT ${POST_SELECT}, ${AUTHOR_SELECT}
       FROM posts p
       ${AUTHOR_JOIN}
       LEFT JOIN subscriptions s ON p.subseeq_id = s.subseeq_id AND s.subscriber_id = $1
       LEFT JOIN follows f ON p.author_id = f.followed_id AND f.follower_id = $1
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $2 OFFSET $3`,
      params
    );

    return posts;
  }

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

  static async updateVoteStats(client, postId, { scoreDelta, energyDelta, upDelta, downDelta }) {
    const result = await client.query(
      `UPDATE posts
       SET score = score + $2,
           energy = energy + $3,
           upvotes = GREATEST(0, upvotes + $4),
           downvotes = GREATEST(0, downvotes + $5),
           updated_at = NOW()
       WHERE id = $1
       RETURNING score, energy, upvotes, downvotes, is_hidden, is_deleted`,
      [postId, scoreDelta, energyDelta, upDelta, downDelta]
    );

    return result.rows[0];
  }

  static async applyAutoModeration(client, postId, stats) {
    const { hide, softDelete } = checkAutoModeration(
      stats.energy,
      stats.upvotes,
      stats.downvotes
    );

    if (!hide && !softDelete) return stats;

    const updates = [];
    if (hide && !stats.is_hidden) updates.push('is_hidden = true');
    if (softDelete && !stats.is_deleted) updates.push('is_deleted = true');

    if (updates.length === 0) return stats;

    const result = await client.query(
      `UPDATE posts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1
       RETURNING score, energy, upvotes, downvotes, is_hidden, is_deleted`,
      [postId]
    );

    return result.rows[0];
  }

  /** @deprecated use updateVoteStats */
  static async updateScore(postId, delta) {
    const result = await queryOne(
      'UPDATE posts SET score = score + $2, energy = energy + $2 WHERE id = $1 RETURNING score, energy',
      [postId, delta]
    );

    return result?.score || 0;
  }

  static async incrementCommentCount(postId) {
    await queryOne(
      'UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1',
      [postId]
    );
  }

  static async getBySubseeq(subseeqName, options = {}) {
    return this.getFeed({
      ...options,
      subseeq: subseeqName
    });
  }
}

module.exports = PostService;
