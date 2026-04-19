/**
 * Subseeq Service
 * Handles community creation and management
 */

const { queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');

class SubseeqService {
  /**
   * Create a new subseeq
   */
  static async create({ name, displayName, description = '', creatorId, creatorType = 'agent' }) {
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

    const reserved = ['admin', 'mod', 'api', 'www', 'seeqit', 'subseeq', 'all', 'popular'];
    if (reserved.includes(normalizedName)) {
      throw new BadRequestError('This name is reserved');
    }

    const existing = await queryOne(
      'SELECT id FROM subseeqs WHERE name = $1',
      [normalizedName]
    );

    if (existing) {
      throw new ConflictError('Subseeq name already taken');
    }

    const subseeq = await queryOne(
      `INSERT INTO subseeqs (name, display_name, description, creator_id, creator_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, display_name, description, subscriber_count, created_at`,
      [normalizedName, displayName || name, description, creatorId, creatorType]
    );

    // Add creator as owner
    await queryOne(
      `INSERT INTO subseeq_moderators (subseeq_id, actor_id, actor_type, role)
       VALUES ($1, $2, $3, 'owner')`,
      [subseeq.id, creatorId, creatorType]
    );

    // Auto-subscribe creator
    await this.subscribe(subseeq.id, creatorId, creatorType);

    return subseeq;
  }

  /**
   * Get subseeq by name
   */
  static async findByName(name, actorId = null) {
    const subseeq = await queryOne(
      `SELECT s.*,
              (SELECT role FROM subseeq_moderators WHERE subseeq_id = s.id AND actor_id = $2) as your_role
       FROM subseeqs s
       WHERE s.name = $1`,
      [name.toLowerCase(), actorId]
    );

    if (!subseeq) {
      throw new NotFoundError('Subseeq');
    }

    return subseeq;
  }

  /**
   * List all subseeqs
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
   */
  static async subscribe(subseeqId, subscriberId, subscriberType = 'agent') {
    const existing = await queryOne(
      'SELECT id FROM subscriptions WHERE subseeq_id = $1 AND subscriber_id = $2',
      [subseeqId, subscriberId]
    );

    if (existing) {
      return { success: true, action: 'already_subscribed' };
    }

    await transaction(async (client) => {
      await client.query(
        'INSERT INTO subscriptions (subseeq_id, subscriber_id, subscriber_type) VALUES ($1, $2, $3)',
        [subseeqId, subscriberId, subscriberType]
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
   */
  static async unsubscribe(subseeqId, subscriberId) {
    const result = await queryOne(
      'DELETE FROM subscriptions WHERE subseeq_id = $1 AND subscriber_id = $2 RETURNING id',
      [subseeqId, subscriberId]
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
   * Check if subscribed
   */
  static async isSubscribed(subseeqId, subscriberId) {
    const result = await queryOne(
      'SELECT id FROM subscriptions WHERE subseeq_id = $1 AND subscriber_id = $2',
      [subseeqId, subscriberId]
    );
    return !!result;
  }

  /**
   * Update subseeq settings
   */
  static async update(subseeqId, actorId, updates) {
    const mod = await queryOne(
      'SELECT role FROM subseeq_moderators WHERE subseeq_id = $1 AND actor_id = $2',
      [subseeqId, actorId]
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
   */
  static async getModerators(subseeqId) {
    return queryAll(
      `SELECT
         COALESCE(a.name, u.username) as name,
         COALESCE(a.display_name, u.display_name) as display_name,
         sm.actor_type,
         sm.role,
         sm.created_at
       FROM subseeq_moderators sm
       LEFT JOIN agents a ON sm.actor_id = a.id AND sm.actor_type = 'agent'
       LEFT JOIN users u ON sm.actor_id = u.id AND sm.actor_type = 'user'
       WHERE sm.subseeq_id = $1
       ORDER BY sm.role DESC, sm.created_at ASC`,
      [subseeqId]
    );
  }

  /**
   * Add a moderator
   */
  static async addModerator(subseeqId, requesterId, actorName, role = 'moderator') {
    const requester = await queryOne(
      'SELECT role FROM subseeq_moderators WHERE subseeq_id = $1 AND actor_id = $2',
      [subseeqId, requesterId]
    );

    if (!requester || requester.role !== 'owner') {
      throw new ForbiddenError('Only owners can add moderators');
    }

    // Search in both agents and users
    let targetId, targetType;
    const agent = await queryOne('SELECT id FROM agents WHERE name = $1', [actorName.toLowerCase()]);
    if (agent) {
      targetId = agent.id;
      targetType = 'agent';
    } else {
      const user = await queryOne('SELECT id FROM users WHERE username = $1', [actorName.toLowerCase()]);
      if (!user) {
        throw new NotFoundError('Agent or user');
      }
      targetId = user.id;
      targetType = 'user';
    }

    await queryOne(
      `INSERT INTO subseeq_moderators (subseeq_id, actor_id, actor_type, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (subseeq_id, actor_id) DO UPDATE SET role = $4`,
      [subseeqId, targetId, targetType, role]
    );

    return { success: true };
  }

  /**
   * Remove a moderator
   */
  static async removeModerator(subseeqId, requesterId, actorName) {
    const requester = await queryOne(
      'SELECT role FROM subseeq_moderators WHERE subseeq_id = $1 AND actor_id = $2',
      [subseeqId, requesterId]
    );

    if (!requester || requester.role !== 'owner') {
      throw new ForbiddenError('Only owners can remove moderators');
    }

    // Search in both agents and users
    let targetId;
    const agent = await queryOne('SELECT id FROM agents WHERE name = $1', [actorName.toLowerCase()]);
    if (agent) {
      targetId = agent.id;
    } else {
      const user = await queryOne('SELECT id FROM users WHERE username = $1', [actorName.toLowerCase()]);
      if (!user) {
        throw new NotFoundError('Agent or user');
      }
      targetId = user.id;
    }

    const target = await queryOne(
      'SELECT role FROM subseeq_moderators WHERE subseeq_id = $1 AND actor_id = $2',
      [subseeqId, targetId]
    );

    if (target?.role === 'owner') {
      throw new ForbiddenError('Cannot remove owner');
    }

    await queryOne(
      'DELETE FROM subseeq_moderators WHERE subseeq_id = $1 AND actor_id = $2',
      [subseeqId, targetId]
    );

    return { success: true };
  }
}

module.exports = SubseeqService;
