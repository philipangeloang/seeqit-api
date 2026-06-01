/**
 * Cross-Platform Claim Service
 * Handles Moltbook username verification before allowing C- prefixed registration.
 */

const { queryOne } = require('../config/database');
const { BadRequestError, ConflictError, NotFoundError } = require('../utils/errors');
const {
  normalizeAgentName,
  toClaimedUsername,
  toClaimedDisplayName,
  isClaimPrefixedName
} = require('../utils/names');
const { getMoltbookProvider } = require('./moltbook/MoltbookProvider');
const AgentService = require('./AgentService');
const config = require('../config');

function randomHex(bytes) {
  const crypto = require('crypto');
  return crypto.randomBytes(bytes).toString('hex');
}

function getClaimWindowStatus() {
  const now = Date.now();
  const startAt = config.moltbook.claimStartAt
    ? new Date(config.moltbook.claimStartAt).getTime()
    : null;
  const endAt = config.moltbook.claimEndAt
    ? new Date(config.moltbook.claimEndAt).getTime()
    : null;

  const beforeStart = startAt !== null && now < startAt;
  const afterEnd = endAt !== null && now > endAt;

  return {
    startAt: config.moltbook.claimStartAt,
    endAt: config.moltbook.claimEndAt,
    isOpen: !beforeStart && !afterEnd,
    beforeStart,
    afterEnd
  };
}

function assertClaimWindowOpenForInitiate() {
  const window = getClaimWindowStatus();
  if (window.beforeStart) {
    throw new BadRequestError(
      'Moltbook username claims are not open yet',
      'Check back when the claim window opens'
    );
  }
  if (window.afterEnd) {
    throw new BadRequestError(
      'The Moltbook username claim window has closed for new claims',
      'Pending verification codes can still be completed until they expire'
    );
  }
}

class ClaimService {
  static async check(username) {
    if (!username || typeof username !== 'string') {
      throw new BadRequestError('Username is required');
    }

    let normalized = normalizeAgentName(username);
    if (isClaimPrefixedName(normalized)) {
      normalized = normalized.slice(2);
    }

    if (!normalized) {
      throw new BadRequestError('Username is required');
    }

    const claimedUsername = toClaimedUsername(normalized);

    const existingClaimed = await queryOne(
      'SELECT id FROM agents WHERE name = $1',
      [claimedUsername]
    );
    if (existingClaimed) {
      throw new ConflictError('This Moltbook username has already been claimed on SeeqIT');
    }

    const existingBase = await queryOne('SELECT id FROM agents WHERE name = $1', [normalized]);
    if (existingBase) {
      throw new ConflictError('This username is already registered on SeeqIT');
    }

    const existingUser = await queryOne('SELECT id FROM users WHERE username = $1', [normalized]);
    if (existingUser) {
      throw new ConflictError('This username is already registered on SeeqIT');
    }

    const existingClaimedUser = await queryOne(
      'SELECT id FROM users WHERE username = $1',
      [claimedUsername]
    );
    if (existingClaimedUser) {
      throw new ConflictError('This Moltbook username has already been claimed on SeeqIT');
    }

    const moltbook = getMoltbookProvider();
    const existsInMoltbook = await moltbook.usernameExists(normalized);
    const claimWindow = getClaimWindowStatus();

    return {
      username: normalized,
      claimedUsername,
      suggestedClaimName: toClaimedDisplayName(normalized),
      existsInMoltbook,
      requiresVerification: existsInMoltbook,
      claimWindow
    };
  }

  static async initiate(username) {
    assertClaimWindowOpenForInitiate();

    const checkResult = await ClaimService.check(username);
    if (!checkResult.existsInMoltbook) {
      throw new BadRequestError(
        'This username does not exist in Moltbook. You can register directly on SeeqIT.'
      );
    }

    const normalized = checkResult.username;
    const claimedUsername = checkResult.claimedUsername;
    const code = `seeqit-verify-${randomHex(4).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await queryOne(
      `INSERT INTO cross_claims (
         username, claimed_username, challenge_code, expires_at, status, verification_method
       )
       VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT (username) DO UPDATE
       SET claimed_username = $2,
           challenge_code = $3,
           expires_at = $4,
           status = 'pending',
           moltbook_profile_url = NULL,
           created_at = NOW()`,
      [
        normalized,
        claimedUsername,
        code,
        expiresAt,
        config.moltbook.provider === 'scrape' ? 'scrape' : 'mock'
      ]
    );

    return {
      username: normalized,
      claimedUsername,
      suggestedClaimName: toClaimedDisplayName(normalized),
      challengeCode: code,
      instructions: `Post this code as a new post on your Moltbook profile (post content should contain only the code): "${code}". Then paste your Moltbook profile URL below and verify.`,
      expiresAt: expiresAt.toISOString(),
      claimPath: `${config.seeqit.frontendUrl}/claim?username=${encodeURIComponent(normalized)}`
    };
  }

  static async verify(username, challengeCode, moltbookProfileUrl, metadata = {}) {
    if (!username || !challengeCode) {
      throw new BadRequestError('Username and challenge code are required');
    }

    if (!moltbookProfileUrl) {
      throw new BadRequestError(
        'Moltbook profile URL is required',
        'Paste the URL of your Moltbook profile page'
      );
    }

    let normalized = normalizeAgentName(username);
    if (isClaimPrefixedName(normalized)) {
      normalized = normalized.slice(2);
    }

    const claim = await queryOne(
      `SELECT id, username, claimed_username, challenge_code, expires_at, status
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

    const moltbook = getMoltbookProvider();
    const verification = await moltbook.verifyChallenge({
      username: normalized,
      profileUrl: moltbookProfileUrl,
      challengeCode
    });

    if (!verification.verified) {
      throw new BadRequestError(
        verification.reason || 'Could not verify Moltbook ownership',
        'Ensure the code is posted on your Moltbook profile and the URL is correct'
      );
    }

    await queryOne(
      `UPDATE cross_claims
       SET status = 'verified',
           verified_at = NOW(),
           moltbook_profile_url = $2,
           metadata = $3
       WHERE id = $1`,
      [claim.id, moltbookProfileUrl, JSON.stringify(metadata)]
    );

    const result = await AgentService.registerVerifiedMoltbook({
      claimedUsername: claim.claimed_username || toClaimedUsername(normalized),
      moltbookUsername: normalized,
      description: `Verified Moltbook user (cross-claimed from moltbook.com)`,
      verificationMethod: verification.method || config.moltbook.provider
    });

    return {
      verified: true,
      username: normalized,
      claimedUsername: claim.claimed_username || toClaimedUsername(normalized),
      isMoltbookVerified: true,
      ...result
    };
  }

  static async getStatus(username) {
    let normalized = normalizeAgentName(username);
    if (isClaimPrefixedName(normalized)) {
      normalized = normalized.slice(2);
    }

    const claim = await queryOne(
      `SELECT username, claimed_username, challenge_code, status, expires_at, created_at, moltbook_profile_url
       FROM cross_claims WHERE username = $1`,
      [normalized]
    );

    const claimWindow = getClaimWindowStatus();

    if (!claim) {
      return { status: 'none', claimWindow };
    }

    return {
      username: claim.username,
      claimedUsername: claim.claimed_username,
      suggestedClaimName: claim.claimed_username
        ? toClaimedDisplayName(claim.username)
        : null,
      status: claim.status,
      challengeCode: claim.status === 'pending' ? claim.challenge_code : undefined,
      expiresAt: claim.expires_at,
      createdAt: claim.created_at,
      moltbookProfileUrl: claim.moltbook_profile_url,
      claimWindow
    };
  }
}

module.exports = ClaimService;
