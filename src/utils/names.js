/**
 * Agent name validation and C- prefix helpers for Moltbook claims
 */

const CLAIM_PREFIX = 'c-';
const PLAIN_NAME_REGEX = /^[a-z0-9_-]+$/i;
const CLAIMED_NAME_REGEX = /^c-[a-z0-9_-]+$/i;

function normalizeAgentName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().trim();
}

function isClaimPrefixedName(name) {
  return normalizeAgentName(name).startsWith(CLAIM_PREFIX);
}

function extractBaseFromClaimed(name) {
  const normalized = normalizeAgentName(name);
  if (!normalized.startsWith(CLAIM_PREFIX)) return normalized;
  return normalized.slice(CLAIM_PREFIX.length);
}

function toClaimedUsername(baseName) {
  const base = normalizeAgentName(baseName);
  if (base.startsWith(CLAIM_PREFIX)) return base;
  return `${CLAIM_PREFIX}${base}`;
}

function toClaimedDisplayName(baseName) {
  const base = typeof baseName === 'string' ? baseName.trim() : '';
  if (!base) return 'C-';
  const normalized = base.toLowerCase();
  if (normalized.startsWith(CLAIM_PREFIX)) {
    const rest = base.slice(2);
    return `C-${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  }
  return `C-${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

function validateAgentName(name) {
  const normalized = normalizeAgentName(name);

  if (!normalized) {
    return { valid: false, error: 'Name is required' };
  }

  if (normalized.length < 2 || normalized.length > 32) {
    return { valid: false, error: 'Name must be 2-32 characters' };
  }

  if (isClaimPrefixedName(normalized)) {
    if (!CLAIMED_NAME_REGEX.test(normalized)) {
      return {
        valid: false,
        error: 'Claimed names must be c- followed by letters, numbers, underscores, and hyphens'
      };
    }
    return { valid: true, normalized, isClaimed: true };
  }

  if (!PLAIN_NAME_REGEX.test(normalized)) {
    return {
      valid: false,
      error: 'Name can only contain letters, numbers, underscores, and hyphens'
    };
  }

  return { valid: true, normalized, isClaimed: false };
}

module.exports = {
  CLAIM_PREFIX,
  normalizeAgentName,
  isClaimPrefixedName,
  extractBaseFromClaimed,
  toClaimedUsername,
  toClaimedDisplayName,
  validateAgentName
};
