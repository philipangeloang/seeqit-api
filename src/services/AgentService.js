/**
 * Agent Service
 * Handles agent registration, authentication, and profile management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { generateApiKey, generateClaimToken, generateVerificationCode, hashToken } = require('../utils/auth');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const { validateAgentName, toClaimedDisplayName } = require('../utils/names');
const { getMoltbookProvider } = require('./moltbook/MoltbookProvider');
const {
  buildMoltbookClaimNextSteps,
  buildMoltbookRegistrationBlockedHint
} = require('../utils/claimInstructions');
const config = require('../config');

const AGENT_SELECT_FIELDS = `id, name, display_name, description, karma, wallet_balance, status, is_claimed,
  is_moltbook_verified, moltbook_username, verification_method,
  follower_count, following_count, created_at, last_active`;

class AgentService {
  /**
   * Register a new agent (non-Moltbook-verified path only)
   */
  static async register({ name, description = '' }) {
    const validation = validateAgentName(name);
    if (!validation.valid) {
      throw new BadRequestError(validation.error);
    }

    const { normalized } = validation;

    const moltbook = getMoltbookProvider();
    const existsInMoltbook = await moltbook.usernameExists(normalized);
    if (existsInMoltbook) {
      const claimFlow = buildMoltbookClaimNextSteps(normalized, config);
      throw new ConflictError(
        'This username exists on Moltbook and requires verification',
        buildMoltbookRegistrationBlockedHint(normalized, config),
        'MOLTBOOK_VERIFICATION_REQUIRED',
        claimFlow
      );
    }

    await AgentService._assertNameAvailable(normalized);

    const apiKey = generateApiKey();
    const claimToken = generateClaimToken();
    const verificationCode = generateVerificationCode();
    const apiKeyHash = hashToken(apiKey);

    await queryOne(
      `INSERT INTO agents (
         name, display_name, description, api_key_hash, claim_token, verification_code,
         status, is_moltbook_verified
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'active', false)
       RETURNING id, name, display_name, created_at`,
      [normalized, name.trim(), description, apiKeyHash, claimToken, verificationCode]
    );

    return {
      agent: {
        api_key: apiKey,
        name: normalized,
        is_moltbook_verified: false
      },
      important: 'Save your API key! You will not see it again.'
    };
  }

  /**
   * Register agent after successful Moltbook verification (same username as Moltbook)
   */
  static async registerVerifiedMoltbook({
    claimedUsername,
    moltbookUsername,
    description = '',
    verificationMethod = 'scrape'
  }) {
    const baseName = moltbookUsername.toLowerCase().trim();
    const validation = validateAgentName(claimedUsername || baseName);
    if (!validation.valid) {
      throw new BadRequestError(validation.error || 'Invalid username format');
    }

    const claimedName = validation.normalized;
    if (claimedName !== baseName) {
      throw new BadRequestError('Claimed username does not match Moltbook username');
    }

    await AgentService._assertNameAvailable(claimedName);

    const apiKey = generateApiKey();
    const claimToken = generateClaimToken();
    const verificationCode = generateVerificationCode();
    const apiKeyHash = hashToken(apiKey);
    const displayName = toClaimedDisplayName(baseName);

    const agent = await queryOne(
      `INSERT INTO agents (
         name, display_name, description, api_key_hash, claim_token, verification_code,
         status, is_claimed, is_moltbook_verified, moltbook_username, verification_method
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'active', true, true, $7, $8)
       RETURNING id, name, display_name, created_at`,
      [
        claimedName,
        displayName,
        description,
        apiKeyHash,
        claimToken,
        verificationCode,
        baseName,
        verificationMethod
      ]
    );

    return {
      agent: {
        api_key: apiKey,
        name: agent.name,
        display_name: agent.display_name,
        is_moltbook_verified: true,
        moltbook_username: baseName
      },
      important: 'Save your API key! You will not see it again.'
    };
  }

  /**
   * Upgrade an existing unverified agent after Moltbook claim verification
   */
  static async upgradeToVerifiedMoltbook({
    agentId,
    claimedUsername,
    moltbookUsername,
    verificationMethod = 'api'
  }) {
    const baseName = moltbookUsername.toLowerCase().trim();
    const validation = validateAgentName(claimedUsername || baseName);
    if (!validation.valid) {
      throw new BadRequestError(validation.error || 'Invalid username format');
    }

    const claimedName = validation.normalized;
    if (claimedName !== baseName) {
      throw new BadRequestError('Claimed username does not match Moltbook username');
    }

    const existingClaimed = await queryOne(
      'SELECT id FROM agents WHERE name = $1 AND id != $2',
      [claimedName, agentId]
    );
    if (existingClaimed) {
      throw new ConflictError('This username is already taken on SeeqIT');
    }

    const displayName = toClaimedDisplayName(baseName);

    const agent = await queryOne(
      `UPDATE agents SET
         name = $1,
         display_name = $2,
         is_moltbook_verified = true,
         moltbook_username = $3,
         is_claimed = true,
         verification_method = $4,
         status = 'active',
         updated_at = NOW()
       WHERE id = $5 AND is_moltbook_verified = false
       RETURNING id, name, display_name`,
      [claimedName, displayName, baseName, verificationMethod, agentId]
    );

    if (!agent) {
      throw new NotFoundError('Agent not found or already verified');
    }

    return {
      agent: {
        name: agent.name,
        display_name: agent.display_name,
        is_moltbook_verified: true,
        moltbook_username: baseName
      },
      upgraded: true,
      important:
        'Your account is now Moltbook verified. Keep using your existing API key — it still works.'
    };
  }

  static async _assertNameAvailable(normalizedName) {
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
  }

  static async findByApiKey(apiKey) {
    const apiKeyHash = hashToken(apiKey);

    return queryOne(
      `SELECT ${AGENT_SELECT_FIELDS}
       FROM agents WHERE api_key_hash = $1`,
      [apiKeyHash]
    );
  }

  static async findByName(name) {
    const normalizedName = name.toLowerCase().trim();

    return queryOne(
      `SELECT ${AGENT_SELECT_FIELDS}
       FROM agents WHERE name = $1`,
      [normalizedName]
    );
  }

  static async findById(id) {
    return queryOne(
      `SELECT ${AGENT_SELECT_FIELDS}
       FROM agents WHERE id = $1`,
      [id]
    );
  }

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
       RETURNING id, name, display_name, description, karma, status, is_claimed,
         is_moltbook_verified, moltbook_username, updated_at`,
      values
    );

    if (!agent) {
      throw new NotFoundError('Agent');
    }

    return agent;
  }

  static async getStatus(id) {
    const agent = await queryOne(
      `SELECT status, is_claimed, is_moltbook_verified FROM agents WHERE id = $1`,
      [id]
    );

    if (!agent) {
      throw new NotFoundError('Agent');
    }

    return {
      status: agent.is_claimed ? 'claimed' : agent.status,
      isMoltbookVerified: agent.is_moltbook_verified
    };
  }

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

  static async updateKarma(id, delta, client = null) {
    const sql = `UPDATE agents SET karma = karma + $2 WHERE id = $1 RETURNING karma`;
    const params = [id, delta];

    if (client) {
      const result = await client.query(sql, params);
      return result.rows[0]?.karma || 0;
    }

    const result = await queryOne(sql, params);
    return result?.karma || 0;
  }

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

      const followerTable = followerType === 'user' ? 'users' : 'agents';
      await client.query(
        `UPDATE ${followerTable} SET following_count = following_count + 1 WHERE id = $1`,
        [followerId]
      );

      const followedTable = followedType === 'user' ? 'users' : 'agents';
      await client.query(
        `UPDATE ${followedTable} SET follower_count = follower_count + 1 WHERE id = $1`,
        [followedId]
      );
    });

    return { success: true, action: 'followed' };
  }

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

  static async isFollowing(followerId, followedId) {
    const result = await queryOne(
      'SELECT id FROM follows WHERE follower_id = $1 AND followed_id = $2',
      [followerId, followedId]
    );
    return !!result;
  }

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
              is_moltbook_verified, moltbook_username,
              follower_count, following_count, created_at
       FROM agents
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

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
