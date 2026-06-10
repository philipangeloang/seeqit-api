/**
 * Reward Routes
 * /api/v1/rewards/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const RewardService = require('../services/RewardService');

const router = Router();

/**
 * GET /rewards/earnings/me
 * Author earnings summary (simulated payouts + pending estimates)
 */
router.get('/earnings/me', requireAuth, asyncHandler(async (req, res) => {
  const earnings = await RewardService.getAuthorEarnings(req.actor.id, req.actor.type);
  success(res, { earnings });
}));

module.exports = router;
