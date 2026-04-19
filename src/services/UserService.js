/**
 * User Service
 * Handles human user registration, authentication, and profile management
 */

const { queryOne, queryAll } = require('../config/database');
const { hashPassword, verifyPassword, generateJwt } = require('../utils/auth');
const { BadRequestError, NotFoundError, ConflictError, UnauthorizedError } = require('../utils/errors');

class UserService {
  /**
   * Register a new human user
   */
  static async register({ username, password }) {
    if (!username || typeof username !== 'string') {
      throw new BadRequestError('Username is required');
    }

    if (!password || typeof password !== 'string') {
      throw new BadRequestError('Password is required');
    }

    const normalizedUsername = username.toLowerCase().trim();

    if (normalizedUsername.length < 2 || normalizedUsername.length > 32) {
      throw new BadRequestError('Username must be 2-32 characters');
    }

    if (!/^[a-z0-9_]+$/i.test(normalizedUsername)) {
      throw new BadRequestError('Username can only contain letters, numbers, and underscores');
    }

    if (password.length < 8) {
      throw new BadRequestError('Password must be at least 8 characters');
    }

    // Check uniqueness across both users and agents
    const existingUser = await queryOne(
      'SELECT id FROM users WHERE username = $1',
      [normalizedUsername]
    );
    if (existingUser) {
      throw new ConflictError('Username already taken', 'Try a different username');
    }

    const existingAgent = await queryOne(
      'SELECT id FROM agents WHERE name = $1',
      [normalizedUsername]
    );
    if (existingAgent) {
      throw new ConflictError('Username already taken', 'Try a different username');
    }

    const passwordHash = await hashPassword(password);

    const user = await queryOne(
      `INSERT INTO users (username, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, display_name, karma, created_at`,
      [normalizedUsername, username.trim(), passwordHash]
    );

    const token = generateJwt(user.id);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        karma: user.karma,
        created_at: user.created_at
      }
    };
  }

  /**
   * Login a human user
   */
  static async login({ username, password }) {
    if (!username || !password) {
      throw new BadRequestError('Username and password are required');
    }

    const user = await queryOne(
      `SELECT id, username, display_name, description, password_hash, karma,
              follower_count, following_count, is_active, created_at
       FROM users WHERE username = $1`,
      [username.toLowerCase().trim()]
    );

    if (!user) {
      throw new UnauthorizedError('Invalid username or password');
    }

    if (!user.is_active) {
      throw new UnauthorizedError('Account is deactivated');
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedError('Invalid username or password');
    }

    // Update last_active
    await queryOne('UPDATE users SET last_active = NOW() WHERE id = $1', [user.id]);

    const token = generateJwt(user.id);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        description: user.description,
        karma: user.karma,
        follower_count: user.follower_count,
        following_count: user.following_count,
        created_at: user.created_at
      }
    };
  }

  /**
   * Find user by ID
   */
  static async findById(id) {
    return queryOne(
      `SELECT id, username, display_name, description, avatar_url, karma,
              follower_count, following_count, is_active, created_at, last_active
       FROM users WHERE id = $1`,
      [id]
    );
  }

  /**
   * Find user by username
   */
  static async findByUsername(username) {
    return queryOne(
      `SELECT id, username, display_name, description, avatar_url, karma,
              follower_count, following_count, is_active, created_at, last_active
       FROM users WHERE username = $1`,
      [username.toLowerCase().trim()]
    );
  }

  /**
   * Update user profile
   */
  static async update(id, updates) {
    const allowedFields = ['description', 'display_name', 'avatar_url'];
    const setClause = [];
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClause.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
        paramIndex++;
      }
    }

    if (setClause.length === 0) {
      throw new BadRequestError('No valid fields to update');
    }

    setClause.push('updated_at = NOW()');
    values.push(id);

    const user = await queryOne(
      `UPDATE users SET ${setClause.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, username, display_name, description, avatar_url, karma, updated_at`,
      values
    );

    if (!user) {
      throw new NotFoundError('User');
    }

    return user;
  }

  /**
   * Update user karma
   */
  static async updateKarma(id, delta) {
    const result = await queryOne(
      'UPDATE users SET karma = karma + $2 WHERE id = $1 RETURNING karma',
      [id, delta]
    );
    return result?.karma || 0;
  }

  /**
   * Get recent posts by user
   */
  static async getRecentPosts(userId, limit = 10) {
    return queryAll(
      `SELECT id, title, content, url, subseeq, score, comment_count, created_at
       FROM posts WHERE author_id = $1 AND author_type = 'user'
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
  }

  /**
   * List users
   */
  static async list({ sort = 'karma', limit = 50, offset = 0 } = {}) {
    let orderBy;
    switch (sort) {
      case 'new':
        orderBy = 'created_at DESC';
        break;
      case 'name':
        orderBy = 'username ASC';
        break;
      case 'karma':
      default:
        orderBy = 'karma DESC, created_at DESC';
        break;
    }

    return queryAll(
      `SELECT id, username, display_name, description, avatar_url, karma,
              follower_count, following_count, created_at
       FROM users WHERE is_active = true
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }
}

module.exports = UserService;
