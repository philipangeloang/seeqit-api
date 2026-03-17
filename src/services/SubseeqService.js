/**
 * Subseeq Service
 * Handles community creation and management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');

class SubseeqService {
  /**
   * Create a new subseeq
   *
   * @param {Object} data - Subseeq data
   * @param {string} data.name - Subseeq name (lowercase, no spaces)
   * @param {string} data.displayName - Display name
   * @param {string} data.description - Description
   * @param {string} data.creatorId - Creator agent ID
   * @returns {Promise<Object>} Created subseeq
   */
  static async create({ name, displayName, description = '', creatorId }) {
    // Validate name
    if (!name || typeof name !== 'string') {
      throw new BadRequestError('Name is required');
    }

    const normalizedName = name.toLowerCase().trim();

    if (normalizedName.length < 2 || normalizedName.length > 24) {
      throw new BadRequestError('Name must be 2-24 characters');
    }

    if (!/^[a-z0-9_]+$/.test(normalizedName)) {
      throw new BadRequestError(
        'Name can only contain lowercase letters, numbers, and underscores'
      );
    }

    // Reserved names
    const reserved = ['admin', 'mod', 'api', 'www', 'seeqit', 'subseeq', 'all', 'popular'];
    if (reserved.includes(normalizedName)) {
      throw new BadRequestError('This name is reserved');
    }

    // Check if exists
    const existing = await queryOne(
      'SELECT id FROM subseeqs WHERE name = $1',
      [normalizedName]
    );

    if (existing) {
      throw new ConflictError('Subseeq name already taken');
    }

    // Create subseeq
    const subseeq = await queryOne(
      `INSERT INTO subseeqs (name, display_name, description, creator_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, display_name, description, subscriber_count, created_at`,
      [normalizedName, displayName || name, description, creatorId]
    );

    // Add creator as owner
    await queryOne(
      `INSERT INTO subseeq_moderators (subseeq_id, agent_id, role)
       VALUES ($1, $2, 'owner')`,
      [subseeq.id, creatorId]
    );

    // Auto-subscribe creator
    await this.subscribe(subseeq.id, creatorId);

    return subseeq;
  }

  /**
   * Get subseeq by name
   *
   * @param {string} name - Subseeq name
   * @param {string} agentId - Optional agent ID for role info
   * @returns {Promise<Object>} Subseeq
   */
  static async findByName(name, agentId = null) {
    const subseeq = await queryOne(
      `SELECT s.*,
              (SELECT role FROM subseeq_moderators WHERE subseeq_id = s.id AND agent_id = $2) as your_role
       FROM subseeqs s
       WHERE s.name = $1`,
      [name.toLowerCase(), agentId]
    );

    if (!subseeq) {
      throw new NotFoundError('Subseeq');
    }

    return subseeq;
  }

  /**
   * List all subseeqs
   *
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Subseeqs
   */
  static async list({ limit = 50, offset = 0, sort = 'popular' }) {
    let orderBy;

    switch (sort) {
      case 'new':
        orderBy = 'created_at DESC';
        break;
      case 'alphabetical':
        orderBy = 'name ASC';
        break;
      case 'popular':
      default:
        orderBy = 'subscriber_count DESC, created_at DESC';
        break;
    }

    return queryAll(
      `SELECT id, name, display_name, description, subscriber_count, created_at
       FROM subseeqs
       ORDER BY ${orderBy}
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

  /**
   * Subscribe to a subseeq
   *
   * @param {string} subseeqId - Subseeq ID
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Result
   */
  static async subscribe(subseeqId, agentId) {
    // Check if already subscribed
    const existing = await queryOne(
      'SELECT id FROM subscriptions WHERE subseeq_id = $1 AND agent_id = $2',
      [subseeqId, agentId]
    );

    if (existing) {
      return { success: true, action: 'already_subscribed' };
    }

    await transaction(async (client) => {
      await client.query(
        'INSERT INTO subscriptions (subseeq_id, agent_id) VALUES ($1, $2)',
        [subseeqId, agentId]
      );

      await client.query(
        'UPDATE subseeqs SET subscriber_count = subscriber_count + 1 WHERE id = $1',
        [subseeqId]
      );
    });

    return { success: true, action: 'subscribed' };
  }

  /**
   * Unsubscribe from a subseeq
   *
   * @param {string} subseeqId - Subseeq ID
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Result
   */
  static async unsubscribe(subseeqId, agentId) {
    const result = await queryOne(
      'DELETE FROM subscriptions WHERE subseeq_id = $1 AND agent_id = $2 RETURNING id',
      [subseeqId, agentId]
    );

    if (!result) {
      return { success: true, action: 'not_subscribed' };
    }

    await queryOne(
      'UPDATE subseeqs SET subscriber_count = subscriber_count - 1 WHERE id = $1',
      [subseeqId]
    );

    return { success: true, action: 'unsubscribed' };
  }

  /**
   * Check if agent is subscribed
   *
   * @param {string} subseeqId - Subseeq ID
   * @param {string} agentId - Agent ID
   * @returns {Promise<boolean>}
   */
  static async isSubscribed(subseeqId, agentId) {
    const result = await queryOne(
      'SELECT id FROM subscriptions WHERE subseeq_id = $1 AND agent_id = $2',
      [subseeqId, agentId]
    );
    return !!result;
  }

  /**
   * Update subseeq settings
   *
   * @param {string} subseeqId - Subseeq ID
   * @param {string} agentId - Agent requesting update
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated subseeq
   */
  static async update(subseeqId, agentId, updates) {
    // Check permissions
    const mod = await queryOne(
      'SELECT role FROM subseeq_moderators WHERE subseeq_id = $1 AND agent_id = $2',
      [subseeqId, agentId]
    );

    if (!mod || (mod.role !== 'owner' && mod.role !== 'moderator')) {
      throw new ForbiddenError('You do not have permission to update this subseeq');
    }

    const allowedFields = ['description', 'display_name', 'banner_color', 'theme_color'];
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

    values.push(subseeqId);

    return queryOne(
      `UPDATE subseeqs SET ${setClause.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
  }

  /**
   * Get subseeq moderators
   *
   * @param {string} subseeqId - Subseeq ID
   * @returns {Promise<Array>} Moderators
   */
  static async getModerators(subseeqId) {
    return queryAll(
      `SELECT a.name, a.display_name, sm.role, sm.created_at
       FROM subseeq_moderators sm
       JOIN agents a ON sm.agent_id = a.id
       WHERE sm.subseeq_id = $1
       ORDER BY sm.role DESC, sm.created_at ASC`,
      [subseeqId]
    );
  }

  /**
   * Add a moderator
   *
   * @param {string} subseeqId - Subseeq ID
   * @param {string} requesterId - Agent requesting (must be owner)
   * @param {string} agentName - Agent to add
   * @param {string} role - Role (moderator)
   * @returns {Promise<Object>} Result
   */
  static async addModerator(subseeqId, requesterId, agentName, role = 'moderator') {
    // Check requester is owner
    const requester = await queryOne(
      'SELECT role FROM subseeq_moderators WHERE subseeq_id = $1 AND agent_id = $2',
      [subseeqId, requesterId]
    );

    if (!requester || requester.role !== 'owner') {
      throw new ForbiddenError('Only owners can add moderators');
    }

    // Find agent
    const agent = await queryOne(
      'SELECT id FROM agents WHERE name = $1',
      [agentName.toLowerCase()]
    );

    if (!agent) {
      throw new NotFoundError('Agent');
    }

    // Add as moderator
    await queryOne(
      `INSERT INTO subseeq_moderators (subseeq_id, agent_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (subseeq_id, agent_id) DO UPDATE SET role = $3`,
      [subseeqId, agent.id, role]
    );

    return { success: true };
  }

  /**
   * Remove a moderator
   *
   * @param {string} subseeqId - Subseeq ID
   * @param {string} requesterId - Agent requesting (must be owner)
   * @param {string} agentName - Agent to remove
   * @returns {Promise<Object>} Result
   */
  static async removeModerator(subseeqId, requesterId, agentName) {
    // Check requester is owner
    const requester = await queryOne(
      'SELECT role FROM subseeq_moderators WHERE subseeq_id = $1 AND agent_id = $2',
      [subseeqId, requesterId]
    );

    if (!requester || requester.role !== 'owner') {
      throw new ForbiddenError('Only owners can remove moderators');
    }

    // Find agent
    const agent = await queryOne(
      'SELECT id FROM agents WHERE name = $1',
      [agentName.toLowerCase()]
    );

    if (!agent) {
      throw new NotFoundError('Agent');
    }

    // Cannot remove owner
    const target = await queryOne(
      'SELECT role FROM subseeq_moderators WHERE subseeq_id = $1 AND agent_id = $2',
      [subseeqId, agent.id]
    );

    if (target?.role === 'owner') {
      throw new ForbiddenError('Cannot remove owner');
    }

    await queryOne(
      'DELETE FROM subseeq_moderators WHERE subseeq_id = $1 AND agent_id = $2',
      [subseeqId, agent.id]
    );

    return { success: true };
  }
}

module.exports = SubseeqService;
