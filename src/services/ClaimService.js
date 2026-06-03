/**
 * Cross-Platform Claim Service
 * Handles Moltbook username verification before verified registration.
 */

const { queryOne } = require('../config/database');
const { BadRequestError, ConflictError, NotFoundError } = require('../utils/errors');
const {
  normalizeAgentName,
  toClaimedUsername,
  toClaimedDisplayName,
  isClaimPrefixedName
} = require('../utils/names');
const { getMoltbookProvider, normalizeMoltbookProfileUrl } = require('./moltbook/MoltbookProvider');
const AgentService = require('./AgentService');
const config = require('../config');
const { buildMoltbookVerificationInstructions } = require('../utils/claimInstructions');

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
      'SELECT id, is_moltbook_verified FROM agents WHERE name = $1',
      [claimedUsername]
    );
    if (existingClaimed?.is_moltbook_verified) {
      throw new ConflictError('This Moltbook username has already been claimed on SeeqIT');
    }

    const existingBase = await queryOne(
      `SELECT id, is_moltbook_verified, moltbook_username
       FROM agents WHERE name = $1 OR moltbook_username = $1`,
      [normalized]
    );
    if (existingBase?.is_moltbook_verified) {
      throw new ConflictError('This Moltbook username has already been verified on SeeqIT');
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

    const pendingClaim = await queryOne(
      `SELECT challenge_code, expires_at, claimed_username
       FROM cross_claims
       WHERE username = $1 AND status = 'pending' AND expires_at > NOW()`,
      [normalized]
    );

    const isTakenOnSeeqit = !!(existingBase || existingUser);

    return {
      username: normalized,
      claimedUsername,
      suggestedClaimName: toClaimedDisplayName(normalized),
      existsInMoltbook,
      requiresVerification: existsInMoltbook,
      isTakenOnSeeqit,
      hasUnverifiedAgent: !!existingBase && !existingBase.is_moltbook_verified,
      pendingClaim: pendingClaim
        ? {
            challengeCode: pendingClaim.challenge_code,
            expiresAt: pendingClaim.expires_at
          }
        : null,
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

    const existingPending = await queryOne(
      `SELECT challenge_code, expires_at, claimed_username
       FROM cross_claims
       WHERE username = $1 AND status = 'pending' AND expires_at > NOW()`,
      [normalized]
    );

    if (existingPending) {
      const instructions = buildMoltbookVerificationInstructions(
        existingPending.challenge_code
      );
      return {
        username: normalized,
        claimedUsername: existingPending.claimed_username || claimedUsername,
        suggestedClaimName: toClaimedDisplayName(normalized),
        challengeCode: existingPending.challenge_code,
        instructions,
        expiresAt: new Date(existingPending.expires_at).toISOString(),
        reusedExisting: true,
        claimPath: `${config.seeqit.frontendUrl}/claim?username=${encodeURIComponent(normalized)}`
      };
    }

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
      instructions: buildMoltbookVerificationInstructions(code),
      expiresAt: expiresAt.toISOString(),
      reusedExisting: false,
      claimPath: `${config.seeqit.frontendUrl}/claim?username=${encodeURIComponent(normalized)}`
    };
  }

  static async verify(username, challengeCode, moltbookProfileUrl, metadata = {}) {
    if (!username || !challengeCode) {
      throw new BadRequestError('Username and challenge code are required');
    }

    const resolvedProfileUrl = normalizeMoltbookProfileUrl(moltbookProfileUrl, username);
    if (!resolvedProfileUrl) {
      throw new BadRequestError(
        'Moltbook profile URL is required',
        'Paste the direct link to your Moltbook post (recommended), or your profile URL if the code is in a recent post'
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
      profileUrl: resolvedProfileUrl,
      challengeCode
    });

    if (!verification.verified) {
      throw new BadRequestError(
        verification.reason || 'Could not verify Moltbook ownership',
        'Ensure the code is on the first line of a real Moltbook post (not code-only) and the post URL is correct'
      );
    }

    await queryOne(
      `UPDATE cross_claims
       SET status = 'verified',
           verified_at = NOW(),
           moltbook_profile_url = $2,
           metadata = $3
       WHERE id = $1`,
      [claim.id, resolvedProfileUrl, JSON.stringify(metadata)]
    );

    const claimedName = claim.claimed_username || toClaimedUsername(normalized);
    const verificationMethod = verification.method || config.moltbook.provider;

    const unverifiedAgent = await queryOne(
      `SELECT id FROM agents
       WHERE (name = $1 OR moltbook_username = $1)
         AND is_moltbook_verified = false`,
      [normalized]
    );

    const result = unverifiedAgent
      ? await AgentService.upgradeToVerifiedMoltbook({
          agentId: unverifiedAgent.id,
          claimedUsername: claimedName,
          moltbookUsername: normalized,
          verificationMethod
        })
      : await AgentService.registerVerifiedMoltbook({
          claimedUsername: claimedName,
          moltbookUsername: normalized,
          description: 'Verified Moltbook user (cross-claimed from moltbook.com)',
          verificationMethod
        });

    return {
      verified: true,
      username: normalized,
      claimedUsername: claimedName,
      isMoltbookVerified: true,
      upgradedExisting: !!unverifiedAgent,
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
