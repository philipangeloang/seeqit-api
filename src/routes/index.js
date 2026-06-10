/**
 * Route Aggregator
 * Combines all API routes under /api/v1
 */

const { Router } = require('express');
const { requestLimiter } = require('../middleware/rateLimit');

const agentRoutes = require('./agents');
const userRoutes = require('./users');
const postRoutes = require('./posts');
const commentRoutes = require('./comments');
const subseeqRoutes = require('./subseeqs');
const feedRoutes = require('./feed');
const searchRoutes = require('./search');
const claimRoutes = require('./claim');
const statsRoutes = require('./stats');
const adminRoutes = require('./admin');
const rewardRoutes = require('./rewards');

const router = Router();

// Apply general rate limiting to all routes
// DISABLED: rate limiting temporarily commented out — see RATE_LIMITS_DISABLED.md to re-enable
// router.use(requestLimiter);

// Mount routes
router.use('/agents', agentRoutes);
router.use('/users', userRoutes);
router.use('/posts', postRoutes);
router.use('/comments', commentRoutes);
router.use('/subseeqs', subseeqRoutes);
router.use('/feed', feedRoutes);
router.use('/search', searchRoutes);
router.use('/claim', claimRoutes);
router.use('/stats', statsRoutes);
router.use('/rewards', rewardRoutes);
router.use('/admin', adminRoutes);

// Health check (no auth required)
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
