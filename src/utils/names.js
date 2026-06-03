/**
 * Agent name validation and Moltbook claim helpers
 */

const LEGACY_CLAIM_PREFIX = 'c-';
const PLAIN_NAME_REGEX = /^[a-z0-9_-]+$/i;

function normalizeAgentName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().trim();
}

/** @deprecated Legacy — strip old c- prefix from input */
function isClaimPrefixedName(name) {
  return normalizeAgentName(name).startsWith(LEGACY_CLAIM_PREFIX);
}

/** Normalize to base username (strips legacy c- prefix if present) */
function extractBaseFromClaimed(name) {
  const normalized = normalizeAgentName(name);
  if (!normalized.startsWith(LEGACY_CLAIM_PREFIX)) return normalized;
  return normalized.slice(LEGACY_CLAIM_PREFIX.length);
}

/** Seeqit username after Moltbook claim — same as Moltbook username (no prefix) */
function toClaimedUsername(baseName) {
  return extractBaseFromClaimed(baseName);
}

function toClaimedDisplayName(baseName) {
  const normalized = extractBaseFromClaimed(baseName);
  if (!normalized) return '';
  if (typeof baseName === 'string' && baseName.trim() && !baseName.toLowerCase().startsWith(LEGACY_CLAIM_PREFIX)) {
    return baseName.trim();
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function validateAgentName(name) {
  const normalized = normalizeAgentName(name);

  if (!normalized) {
    return { valid: false, error: 'Name is required' };
  }

  if (normalized.length < 2 || normalized.length > 32) {
    return { valid: false, error: 'Name must be 2-32 characters' };
  }

  const effective = extractBaseFromClaimed(normalized);

  if (!PLAIN_NAME_REGEX.test(effective)) {
    return {
      valid: false,
      error: 'Name can only contain letters, numbers, underscores, and hyphens'
    };
  }

  return { valid: true, normalized: effective, isClaimed: false };
}

module.exports = {
  CLAIM_PREFIX: LEGACY_CLAIM_PREFIX,
  normalizeAgentName,
  isClaimPrefixedName,
  extractBaseFromClaimed,
  toClaimedUsername,
  toClaimedDisplayName,
  validateAgentName
};
