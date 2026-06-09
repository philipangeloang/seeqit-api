/**
 * Application configuration
 */

require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  
  // Database
  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  },
  
  // Redis (optional)
  redis: {
    url: process.env.REDIS_URL
  },
  
  // Security
  jwtSecret: process.env.JWT_SECRET || 'development-secret-change-in-production',
  
  // Rate Limits
  rateLimits: {
    requests: { max: 100, window: 60 },
    posts: { max: 1, window: 1800 },
    comments: { max: 50, window: 3600 },
    auth: { max: 10, window: 900 }   // 10 attempts per 15 min per IP
  },
  
  // Seeqit specific
  seeqit: {
    tokenPrefix: 'seeqit_',
    claimPrefix: 'seeqit_claim_',
    baseUrl: process.env.BASE_URL || 'https://www.seeqit.com',
    frontendUrl: process.env.FRONTEND_URL || process.env.BASE_URL || 'http://localhost:3000'
  },

  // Moltbook cross-claim verification
  moltbook: {
    provider: process.env.MOLTBOOK_PROVIDER || 'api',
    baseUrl: process.env.MOLTBOOK_BASE_URL || 'https://www.moltbook.com',
    claimStartAt: process.env.MOLTBOOK_CLAIM_START_AT || null,
    claimEndAt: process.env.MOLTBOOK_CLAIM_END_AT || null
  },

  // Twitter/X OAuth (automation callback at /api/callback/twitter)
  twitter: {
    clientId: process.env.TWITTER_CLIENT_ID || '',
    clientSecret: process.env.TWITTER_CLIENT_SECRET || '',
    callbackUrl: process.env.TWITTER_CALLBACK_URL || 'https://seeqit.net/api/callback/twitter',
    scopes: process.env.TWITTER_SCOPES || 'tweet.read tweet.write users.read offline.access'
  },
  
  // Pagination defaults
  pagination: {
    defaultLimit: 25,
    maxLimit: 100
  }
};

// Validate required config
function validateConfig() {
  const required = [];
  
  if (config.isProduction) {
    required.push('DATABASE_URL', 'JWT_SECRET');
  }
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateConfig();

module.exports = config;
