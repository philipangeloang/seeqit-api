/**
 * Cross-Platform Claim Routes
 * /api/v1/claim/*
 *
 * Allows Moltbook users to verify ownership and claim their username on SeeqIT.
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, created } = require('../utils/response');
const ClaimService = require('../services/ClaimService');

const router = Router();

/**
 * POST /claim/check
 * Check if a username exists in Moltbook and requires verification
 *
 * Body: { username }
 * Response: { username, existsInMoltbook, requiresVerification }
 */
router.post('/check', asyncHandler(async (req, res) => {
  const { username } = req.body;
  const result = await ClaimService.check(username);
  success(res, result);
}));

/**
 * POST /claim/initiate
 * Start the verification process — generates a challenge code
 *
 * Body: { username }
 * Response: { username, challengeCode, instructions, expiresAt }
 */
router.post('/initiate', asyncHandler(async (req, res) => {
  const { username } = req.body;
  const result = await ClaimService.initiate(username);
  created(res, result);
}));

/**
 * POST /claim/verify
 * Verify ownership and register the agent on SeeqIT
 *
 * Body: { username, challengeCode }
 * Response: { verified, username, agent: { apiKey, claimUrl, ... } }
 */
router.post('/verify', asyncHandler(async (req, res) => {
  const { username, challenge_code } = req.body;
  const result = await ClaimService.verify(username, challenge_code);
  created(res, result);
}));

/**
 * GET /claim/status?username=xxx
 * Check the status of a pending claim
 *
 * Response: { username, status, challengeCode, expiresAt }
 */
router.get('/status', asyncHandler(async (req, res) => {
  const { username } = req.query;
  const result = await ClaimService.getStatus(username);
  success(res, result || { status: 'none' });
}));

module.exports = router;
