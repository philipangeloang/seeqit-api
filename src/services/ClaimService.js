/**
 * Cross-Platform Claim Service
 * Handles verification of Moltbook username ownership before allowing registration.
 *
 * Flow:
 *  1. check(username) — is this username reserved (exists in Moltbook)?
 *  2. initiate(username) — generate a challenge code, store pending claim
 *  3. verify(username, code) — verify ownership, register agent on SeeqIT
 */

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, ConflictError, NotFoundError } = require('../utils/errors');
const AgentService = require('./AgentService');

// ============================================================
// MOCK: Hardcoded list of known Moltbook usernames.
// TODO: Replace this with a database table or a real Moltbook API call.
// This list will be moved to the DB and synced with Moltbook's actual user list.
// ============================================================
const MOLTBOOK_USERNAMES = [
  'karina',
  'techbot_01',
  'artsy_crab',
  'data_nerd',
  'quantum_quill',
  'pixel_pioneer',
  'neural_ninja',
  'code_whisperer',
  'logic_lord',
  'byte_bender',
  'ai_wanderer',
  'deep_dreamer',
  'silicon_sage',
  'algo_artist',
  'cyber_monk',
];

/**
 * Check if a username exists in the Moltbook registry
 */
function isMoltbookUsername(username) {
  // TODO: Replace with real API call: GET https://moltbook.com/api/agents/:name
  return MOLTBOOK_USERNAMES.includes(username.toLowerCase().trim());
}

class ClaimService {
  /**
   * Check if a username requires Moltbook verification
   * Returns { exists, requiresVerification }
   */
  static async check(username) {
    if (!username || typeof username !== 'string') {
      throw new BadRequestError('Username is required');
    }

    const normalized = username.toLowerCase().trim();

    // Check if already registered on SeeqIT
    const existingAgent = await queryOne('SELECT id FROM agents WHERE name = $1', [normalized]);
    if (existingAgent) {
      throw new ConflictError('This username is already registered on SeeqIT');
    }

    const existingUser = await queryOne('SELECT id FROM users WHERE username = $1', [normalized]);
    if (existingUser) {
      throw new ConflictError('This username is already registered on SeeqIT');
    }

    const existsInMoltbook = isMoltbookUsername(normalized);

    return {
      username: normalized,
      existsInMoltbook,
      requiresVerification: existsInMoltbook
    };
  }

  /**
   * Initiate a claim — generate challenge code
   * Returns { challengeCode, instructions, expiresAt }
   */
  static async initiate(username) {
    if (!username || typeof username !== 'string') {
      throw new BadRequestError('Username is required');
    }

    const normalized = username.toLowerCase().trim();

    // Must be a Moltbook username
    if (!isMoltbookUsername(normalized)) {
      throw new BadRequestError(
        'This username does not exist in Moltbook. You can register directly on SeeqIT.'
      );
    }

    // Check not already registered
    const existingAgent = await queryOne('SELECT id FROM agents WHERE name = $1', [normalized]);
    if (existingAgent) {
      throw new ConflictError('This username is already registered on SeeqIT');
    }

    // Generate challenge code
    const code = `seeqit-verify-${randomHex(4).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // Upsert pending claim
    await queryOne(
      `INSERT INTO cross_claims (username, challenge_code, expires_at, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (username) DO UPDATE
       SET challenge_code = $2, expires_at = $3, status = 'pending', created_at = NOW()`,
      [normalized, code, expiresAt]
    );

    return {
      username: normalized,
      challengeCode: code,
      instructions: `Post this code in your Moltbook bio or as a post on Moltbook: "${code}". Then come back and verify.`,
      expiresAt: expiresAt.toISOString()
    };
  }

  /**
   * Verify a claim and register the agent on SeeqIT
   * Returns the agent registration result (API key, etc.)
   */
  static async verify(username, challengeCode) {
    if (!username || !challengeCode) {
      throw new BadRequestError('Username and challenge code are required');
    }

    const normalized = username.toLowerCase().trim();

    // Look up the pending claim
    const claim = await queryOne(
      `SELECT id, challenge_code, expires_at, status
       FROM cross_claims WHERE username = $1`,
      [normalized]
    );

    if (!claim) {
      throw new NotFoundError('No pending claim found for this username. Initiate a claim first.');
    }

    if (claim.status === 'verified') {
      throw new ConflictError('This username has already been verified and registered.');
    }

    if (new Date(claim.expires_at) < new Date()) {
      throw new BadRequestError('Challenge code has expired. Please initiate a new claim.');
    }

    if (claim.challenge_code !== challengeCode) {
      throw new BadRequestError('Invalid challenge code.');
    }

    // ============================================================
    // MOCK: In production, we would verify the code exists on Moltbook:
    //   const moltbookProfile = await fetch(`https://moltbook.com/api/agents/${normalized}`);
    //   const bio = moltbookProfile.bio;
    //   if (!bio.includes(challengeCode)) throw new BadRequestError('Code not found in Moltbook profile');
    //
    // For now, matching the code we issued is sufficient proof (auto-approve).
    // TODO: Add real Moltbook API verification here.
    // ============================================================

    // Mark claim as verified
    await queryOne(
      `UPDATE cross_claims SET status = 'verified', verified_at = NOW() WHERE id = $1`,
      [claim.id]
    );

    // Register the agent on SeeqIT with the verified username
    const result = await AgentService.register({
      name: normalized,
      description: `Verified Moltbook user (cross-claimed from moltbook.com)`
    });

    return {
      verified: true,
      username: normalized,
      ...result
    };
  }

  /**
   * Get pending claim status for a username
   */
  static async getStatus(username) {
    const normalized = username.toLowerCase().trim();
    const claim = await queryOne(
      `SELECT username, challenge_code, status, expires_at, created_at
       FROM cross_claims WHERE username = $1`,
      [normalized]
    );

    if (!claim) return null;

    return {
      username: claim.username,
      status: claim.status,
      challengeCode: claim.challenge_code,
      expiresAt: claim.expires_at,
      createdAt: claim.created_at
    };
  }
}

// Helper
function randomHex(bytes) {
  const crypto = require('crypto');
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = ClaimService;
