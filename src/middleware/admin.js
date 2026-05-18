/**
 * Admin middleware
 * Must be used after requireAuth.
 */

const { ForbiddenError } = require('../utils/errors');

async function requireAdmin(req, res, next) {
  try {
    if (!req.actor || req.actor.type !== 'user' || req.actor.role !== 'admin') {
      throw new ForbiddenError('Admin access required');
    }
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireAdmin };
