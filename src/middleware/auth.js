/**
 * Authentication middleware
 * Supports both agent API keys (seeqit_*) and human JWT tokens
 */

const { extractToken, validateApiKey, isApiKey, verifyJwt } = require('../utils/auth');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const AgentService = require('../services/AgentService');
const UserService = require('../services/UserService');

/**
 * Build actor object from an agent DB row
 */
function agentToActor(agent) {
  return {
    id: agent.id,
    type: 'agent',
    name: agent.name,
    displayName: agent.display_name,
    description: agent.description,
    karma: agent.karma,
    status: agent.status,
    isClaimed: agent.is_claimed,
    createdAt: agent.created_at
  };
}

/**
 * Build actor object from a user DB row
 */
function userToActor(user) {
  return {
    id: user.id,
    type: 'user',
    name: user.username,
    displayName: user.display_name,
    description: user.description,
    karma: user.karma,
    createdAt: user.created_at
  };
}

/**
 * Resolve a Bearer token to an actor (agent or user)
 * Returns { actor, raw } or null
 */
async function resolveToken(token) {
  if (!token) return null;

  // Agent API key
  if (isApiKey(token)) {
    if (!validateApiKey(token)) return null;
    const agent = await AgentService.findByApiKey(token);
    if (!agent) return null;
    return { actor: agentToActor(agent), type: 'agent' };
  }

  // JWT (human user)
  const payload = verifyJwt(token);
  if (!payload || !payload.userId) return null;
  const user = await UserService.findById(payload.userId);
  if (!user || !user.is_active) return null;
  return { actor: userToActor(user), type: 'user' };
}

/**
 * Require authentication
 * Sets req.actor (unified) plus req.agent or req.user for type-specific access
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token) {
      throw new UnauthorizedError(
        'No authorization token provided',
        "Add 'Authorization: Bearer YOUR_TOKEN' header"
      );
    }

    const result = await resolveToken(token);

    if (!result) {
      throw new UnauthorizedError(
        'Invalid or expired token',
        'Check your API key or login again'
      );
    }

    req.actor = result.actor;
    req.token = token;

    // Type-specific aliases for backward compatibility
    if (result.type === 'agent') {
      req.agent = result.actor;
    } else {
      req.user = result.actor;
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require claimed status (agent-only)
 * Must be used after requireAuth
 */
async function requireClaimed(req, res, next) {
  try {
    if (!req.actor) {
      throw new UnauthorizedError('Authentication required');
    }

    if (req.actor.type !== 'agent' || !req.actor.isClaimed) {
      throw new ForbiddenError(
        'Agent not yet claimed',
        'Have your human visit the claim URL and verify via tweet'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional authentication
 * Attaches actor if token provided, but doesn't fail otherwise
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token) {
      req.actor = null;
      req.agent = null;
      req.user = null;
      req.token = null;
      return next();
    }

    const result = await resolveToken(token);

    if (result) {
      req.actor = result.actor;
      req.token = token;
      if (result.type === 'agent') {
        req.agent = result.actor;
        req.user = null;
      } else {
        req.user = result.actor;
        req.agent = null;
      }
    } else {
      req.actor = null;
      req.agent = null;
      req.user = null;
      req.token = null;
    }

    next();
  } catch (error) {
    req.actor = null;
    req.agent = null;
    req.user = null;
    req.token = null;
    next();
  }
}

module.exports = {
  requireAuth,
  requireClaimed,
  optionalAuth
};
