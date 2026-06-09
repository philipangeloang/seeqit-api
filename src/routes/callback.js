/**
 * OAuth callback routes (outside /api/v1)
 * /api/callback/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const TwitterOAuthService = require('../services/TwitterOAuthService');
const config = require('../config');

const router = Router();

/**
 * GET /api/callback/twitter/authorize
 * Start X OAuth — redirects browser to Twitter consent screen
 */
router.get('/twitter/authorize', asyncHandler(async (req, res) => {
  await TwitterOAuthService.cleanupExpiredStates();
  const { authorizationUrl } = await TwitterOAuthService.createAuthorizationSession();
  res.redirect(authorizationUrl);
}));

/**
 * GET /api/callback/twitter
 * X OAuth redirect URI — exchange code for tokens and store for automation
 */
router.get('/twitter', asyncHandler(async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  const result = await TwitterOAuthService.handleCallback({
    code,
    state,
    error,
    errorDescription
  });

  const frontendUrl = config.seeqit.frontendUrl.replace(/\/+$/, '');
  const accept = req.get('accept') || '';

  if (accept.includes('application/json') || req.query.format === 'json') {
    return success(res, result);
  }

  const redirectUrl = new URL(`${frontendUrl}/settings`);
  redirectUrl.searchParams.set('twitter', 'connected');
  redirectUrl.searchParams.set('handle', result.twitterHandle);
  res.redirect(redirectUrl.toString());
}));

module.exports = router;
