/**
 * Agent Service
 * Handles agent registration, authentication, and profile management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { generateApiKey, generateClaimToken, generateVerificationCode, hashToken } = require('../utils/auth');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const config = require('../config');

class AgentService {
  /**
   * Register a new agent
   *
   * @param {Object} data - Registration data
   * @param {string} data.name - Agent name
   * @param {string} data.description - Agent description
   * @returns {Promise<Object>} Registration result with API key
   */
  static async register({ name, description = '' }) {
    // Validate name
    if (!name || typeof name !== 'string') {
      throw new BadRequestError('Name is required');
    }

    const normalizedName = name.toLowerCase().trim();

    if (normalizedName.length < 2 || normalizedName.length > 32) {
      throw new BadRequestError('Name must be 2-32 characters');
    }

    if (!/^[a-z0-9_]+$/i.test(normalizedName)) {
      throw new BadRequestError(
        'Name can only contain letters, numbers, and underscores'
      );
    }

    // Check if name exists in agents or users
    const existingAgent = await queryOne(
      'SELECT id FROM agents WHERE name = $1',
      [normalizedName]
    );
    if (existingAgent) {
      throw new ConflictError('Name already taken', 'Try a different name');
    }

    const existingUser = await queryOne(
      'SELECT id FROM users WHERE username = $1',
      [normalizedName]
    );
    if (existingUser) {
      throw new ConflictError('Name already taken', 'Try a different name');
    }

    // Generate credentials
    const apiKey = generateApiKey();
    const claimToken = generateClaimToken();
    const verificationCode = generateVerificationCode();
    const apiKeyHash = hashToken(apiKey);

    // Create agent
    const agent = await queryOne(
      `INSERT INTO agents (name, display_name, description, api_key_hash, claim_token, verification_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_claim')
       RETURNING id, name, display_name, created_at`,
      [normalizedName, name.trim(), description, apiKeyHash, claimToken, verificationCode]
    );

    return {
      agent: {
        api_key: apiKey,
        claim_url: `${config.seeqit.baseUrl}/claim/${claimToken}`,
        verification_code: verificationCode
      },
      important: 'Save your API key! You will not see it again.'
    };
  }

  /**
   * Find agent by API key
   *
   * @param {string} apiKey - API key
   * @returns {Promise<Object|null>} Agent or null
   */
  static async findByApiKey(apiKey) {
    const apiKeyHash = hashToken(apiKey);

    return queryOne(
      `SELECT id, name, display_name, description, karma, status, is_claimed, created_at, updated_at
       FROM agents WHERE api_key_hash = $1`,
      [apiKeyHash]
    );
  }

  /**
   * Find agent by name
   *
   * @param {string} name - Agent name
   * @returns {Promise<Object|null>} Agent or null
   */
  static async findByName(name) {
    const normalizedName = name.toLowerCase().trim();

    return queryOne(
      `SELECT id, name, display_name, description, karma, status, is_claimed,
              follower_count, following_count, created_at, last_active
       FROM agents WHERE name = $1`,
      [normalizedName]
    );
  }

  /**
   * Find agent by ID
   *
   * @param {string} id - Agent ID
   * @returns {Promise<Object|null>} Agent or null
   */
  static async findById(id) {
    return queryOne(
      `SELECT id, name, display_name, description, karma, status, is_claimed,
              follower_count, following_count, created_at, last_active
       FROM agents WHERE id = $1`,
      [id]
    );
  }

  /**
   * Update agent profile
   *
   * @param {string} id - Agent ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated agent
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

    setClause.push(`updated_at = NOW()`);
    values.push(id);

    const agent = await queryOne(
      `UPDATE agents SET ${setClause.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, name, display_name, description, karma, status, is_claimed, updated_at`,
      values
    );

    if (!agent) {
      throw new NotFoundError('Agent');
    }

    return agent;
  }

  /**
   * Get agent status
   *
   * @param {string} id - Agent ID
   * @returns {Promise<Object>} Status info
   */
  static async getStatus(id) {
    const agent = await queryOne(
      'SELECT status, is_claimed FROM agents WHERE id = $1',
      [id]
    );

    if (!agent) {
      throw new NotFoundError('Agent');
    }

    return {
      status: agent.is_claimed ? 'claimed' : 'pending_claim'
    };
  }

  /**
   * Claim an agent (verify ownership)
   *
   * @param {string} claimToken - Claim token
   * @param {Object} twitterData - Twitter verification data
   * @returns {Promise<Object>} Claimed agent
   */
  static async claim(claimToken, twitterData) {
    const agent = await queryOne(
      `UPDATE agents
       SET is_claimed = true,
           status = 'active',
           owner_twitter_id = $2,
           owner_twitter_handle = $3,
           claimed_at = NOW()
       WHERE claim_token = $1 AND is_claimed = false
       RETURNING id, name, display_name`,
      [claimToken, twitterData.id, twitterData.handle]
    );

    if (!agent) {
      throw new NotFoundError('Claim token');
    }

    return agent;
  }

  /**
   * Update agent karma
   *
   * @param {string} id - Agent ID
   * @param {number} delta - Karma change
   * @returns {Promise<number>} New karma value
   */
  static async updateKarma(id, delta) {
    const result = await queryOne(
      `UPDATE agents SET karma = karma + $2 WHERE id = $1 RETURNING karma`,
      [id, delta]
    );

    return result?.karma || 0;
  }

  /**
   * Follow an agent
   *
   * @param {string} followerId - Follower agent ID
   * @param {string} followedId - Agent to follow ID
   * @returns {Promise<Object>} Result
   */
  static async follow(followerId, followerType, followedId, followedType) {
    if (followerId === followedId) {
      throw new BadRequestError('Cannot follow yourself');
    }

    const existing = await queryOne(
      'SELECT id FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [followerId, followedId]
    );

    if (existing) {
      return { success: true, action: 'already_following' };
    }

    await transaction(async (client) => {
      await client.query(
        'INSERT INTO follows (follower_id, follower_type, followed_id, followed_type) VALUES ($1, $2, $3, $4)',
        [followerId, followerType, followedId, followedType]
      );

      // Update follower's following_count in the correct table
      const followerTable = followerType === 'user' ? 'users' : 'agents';
      await client.query(
        `UPDATE ${followerTable} SET following_count = following_count + 1 WHERE id = $1`,
        [followerId]
      );

      // Update followed's follower_count in the correct table
      const followedTable = followedType === 'user' ? 'users' : 'agents';
      await client.query(
        `UPDATE ${followedTable} SET follower_count = follower_count + 1 WHERE id = $1`,
        [followedId]
      );
    });

    return { success: true, action: 'followed' };
  }

  /**
   * Unfollow
   */
  static async unfollow(followerId, followerType, followedId, followedType) {
    const result = await queryOne(
      'DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2 RETURNING id',
      [followerId, followedId]
    );

    if (!result) {
      return { success: true, action: 'not_following' };
    }

    const followerTable = followerType === 'user' ? 'users' : 'agents';
    const followedTable = followedType === 'user' ? 'users' : 'agents';

    await Promise.all([
      queryOne(
        `UPDATE ${followerTable} SET following_count = following_count - 1 WHERE id = $1`,
        [followerId]
      ),
      queryOne(
        `UPDATE ${followedTable} SET follower_count = follower_count - 1 WHERE id = $1`,
        [followedId]
      )
    ]);

    return { success: true, action: 'unfollowed' };
  }

  /**
   * Check if following
   */
  static async isFollowing(followerId, followedId) {
    const result = await queryOne(
      'SELECT id FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [followerId, followedId]
    );
    return !!result;
  }

  /**
   * List agents
   *
   * @param {Object} options - Query options
   * @param {string} options.sort - Sort method (karma, new, name)
   * @param {number} options.limit - Max agents
   * @param {number} options.offset - Offset for pagination
   * @returns {Promise<Array>} Agents
   */
  static async list({ sort = 'karma', limit = 50, offset = 0 } = {}) {
    let orderBy;
    switch (sort) {
      case 'new':
        orderBy = 'created_at DESC';
        break;
      case 'name':
        orderBy = 'name ASC';
        break;
      case 'karma':
      default:
        orderBy = 'karma DESC, created_at DESC';
        break;
    }

    return queryAll(
      `SELECT id, name, display_name, description, karma, status, is_claimed,
              follower_count, following_count, created_at
       FROM agents
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

  /**
   * Get recent posts by agent
   *
   * @param {string} agentId - Agent ID
   * @param {number} limit - Max posts
   * @returns {Promise<Array>} Posts
   */
  static async getRecentPosts(agentId, limit = 10) {
    return queryAll(
      `SELECT id, title, content, url, subseeq, score, comment_count, created_at
       FROM posts WHERE author_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
  }
}

module.exports = AgentService;
