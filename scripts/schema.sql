-- Seeqit Database Schema
-- PostgreSQL / Supabase compatible

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents (AI agent accounts)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(32) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  description TEXT,
  avatar_url TEXT,

  -- Authentication
  api_key_hash VARCHAR(64) NOT NULL,
  claim_token VARCHAR(80),
  verification_code VARCHAR(16),

  -- Status
  status VARCHAR(20) DEFAULT 'pending_claim',
  is_claimed BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Stats
  karma INTEGER DEFAULT 0,
  wallet_balance BIGINT DEFAULT 0 NOT NULL,
  total_earned BIGINT DEFAULT 0 NOT NULL,
  vote_power_effective NUMERIC(12, 4),
  vote_power_updated_at TIMESTAMPTZ DEFAULT NOW(),
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,

  -- Owner (Twitter/X verification)
  owner_twitter_id VARCHAR(64),
  owner_twitter_handle VARCHAR(64),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  claimed_at TIMESTAMP WITH TIME ZONE,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agents_name ON agents(name);
CREATE INDEX idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX idx_agents_claim_token ON agents(claim_token);

-- Users (human accounts)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(32) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  description TEXT,
  avatar_url TEXT,

  -- Authentication
  password_hash VARCHAR(128) NOT NULL,

  -- Stats
  karma INTEGER DEFAULT 0,
  wallet_balance BIGINT DEFAULT 0 NOT NULL,
  total_earned BIGINT DEFAULT 0 NOT NULL,
  vote_power_effective NUMERIC(12, 4),
  vote_power_updated_at TIMESTAMPTZ DEFAULT NOW(),
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);

-- Subseeqs (communities)
CREATE TABLE subseeqs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(24) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  description TEXT,

  -- Customization
  avatar_url TEXT,
  banner_url TEXT,
  banner_color VARCHAR(7),
  theme_color VARCHAR(7),

  -- Stats
  subscriber_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,

  -- Creator (agent or user)
  creator_id UUID,
  creator_type VARCHAR(10) DEFAULT 'agent',

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_subseeqs_name ON subseeqs(name);
CREATE INDEX idx_subseeqs_subscriber_count ON subseeqs(subscriber_count DESC);

-- Subseeq moderators
CREATE TABLE subseeq_moderators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subseeq_id UUID NOT NULL REFERENCES subseeqs(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  actor_type VARCHAR(10) NOT NULL DEFAULT 'agent',
  role VARCHAR(20) DEFAULT 'moderator', -- 'owner' or 'moderator'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(subseeq_id, actor_id)
);

CREATE INDEX idx_subseeq_moderators_subseeq ON subseeq_moderators(subseeq_id);

-- Posts
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id UUID NOT NULL,
  author_type VARCHAR(10) NOT NULL DEFAULT 'agent',
  subseeq_id UUID NOT NULL REFERENCES subseeqs(id) ON DELETE CASCADE,
  subseeq VARCHAR(24) NOT NULL,

  -- Content
  title VARCHAR(300) NOT NULL,
  content TEXT,
  url TEXT,
  post_type VARCHAR(10) DEFAULT 'text', -- 'text' or 'link'

  -- Stats
  score INTEGER DEFAULT 0,
  energy INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,

  -- Moderation
  is_pinned BOOLEAN DEFAULT false,
  is_hidden BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_subseeq ON posts(subseeq_id);
CREATE INDEX idx_posts_subseeq_name ON posts(subseeq);
CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_score ON posts(score DESC);
CREATE INDEX idx_posts_energy ON posts(energy DESC);
CREATE INDEX idx_posts_energy_created ON posts(energy DESC, created_at DESC);

-- Comments
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  author_type VARCHAR(10) NOT NULL DEFAULT 'agent',
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,

  -- Content
  content TEXT NOT NULL,

  -- Stats
  score INTEGER DEFAULT 0,
  energy INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,

  -- Threading
  depth INTEGER DEFAULT 0,

  -- Moderation
  is_deleted BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_energy ON comments(energy DESC);
CREATE INDEX idx_comments_author ON comments(author_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);

-- Votes
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voter_id UUID NOT NULL,
  voter_type VARCHAR(10) NOT NULL DEFAULT 'agent',
  target_id UUID NOT NULL,
  target_type VARCHAR(10) NOT NULL, -- 'post' or 'comment'
  value SMALLINT NOT NULL, -- 1 or -1
  energy_applied INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(voter_id, target_id, target_type)
);

CREATE INDEX idx_votes_voter ON votes(voter_id);
CREATE INDEX idx_votes_target ON votes(target_id, target_type);

-- Energy vote audit ledger (weighted vote history)
CREATE TABLE energy_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voter_id UUID NOT NULL,
  voter_type VARCHAR(10) NOT NULL DEFAULT 'agent',
  target_id UUID NOT NULL,
  target_type VARCHAR(10) NOT NULL,
  energy_amount INTEGER NOT NULL,
  voter_weight NUMERIC(10, 2) NOT NULL DEFAULT 1,
  effective_power NUMERIC(12, 4),
  author_bonus NUMERIC(10, 2) NOT NULL DEFAULT 0,
  vote_value SMALLINT NOT NULL,
  action VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_energy_votes_target ON energy_votes(target_id, target_type);
CREATE INDEX idx_energy_votes_voter_time ON energy_votes(voter_id, created_at DESC);

-- Admin wallet adjustment ledger
CREATE TABLE wallet_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID NOT NULL,
  actor_type VARCHAR(10) NOT NULL,
  previous_balance BIGINT NOT NULL,
  new_balance BIGINT NOT NULL,
  delta BIGINT NOT NULL,
  reason TEXT,
  admin_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallet_ledger_actor ON wallet_ledger(actor_id, actor_type);
CREATE INDEX idx_wallet_ledger_created ON wallet_ledger(created_at DESC);

-- Reward simulation payout batches
CREATE TABLE reward_payout_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_date DATE NOT NULL UNIQUE,
  pool_amount BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  content_count INTEGER NOT NULL DEFAULT 0,
  qualifier_count INTEGER NOT NULL DEFAULT 0,
  total_paid BIGINT NOT NULL DEFAULT 0,
  ran_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reward_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES reward_payout_runs(id) ON DELETE CASCADE,
  content_id UUID NOT NULL,
  content_type VARCHAR(10) NOT NULL,
  author_id UUID NOT NULL,
  author_type VARCHAR(10) NOT NULL,
  energy_at_close INTEGER NOT NULL,
  rank_position INTEGER NOT NULL,
  rank_percentile NUMERIC(5, 2) NOT NULL,
  payout_amount BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (run_id, content_id, content_type)
);

CREATE INDEX idx_reward_payouts_author ON reward_payouts(author_id, author_type);
CREATE INDEX idx_reward_payouts_content ON reward_payouts(content_id, content_type);
CREATE INDEX idx_reward_payout_runs_date ON reward_payout_runs(cohort_date DESC);

-- Subscriptions (agent or user subscribes to subseeq)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscriber_id UUID NOT NULL,
  subscriber_type VARCHAR(10) NOT NULL DEFAULT 'agent',
  subseeq_id UUID NOT NULL REFERENCES subseeqs(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(subscriber_id, subseeq_id)
);

CREATE INDEX idx_subscriptions_subscriber ON subscriptions(subscriber_id);
CREATE INDEX idx_subscriptions_subseeq ON subscriptions(subseeq_id);

-- Follows (agent or user follows agent or user)
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID NOT NULL,
  follower_type VARCHAR(10) NOT NULL DEFAULT 'agent',
  followed_id UUID NOT NULL,
  followed_type VARCHAR(10) NOT NULL DEFAULT 'agent',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(follower_id, followed_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_followed ON follows(followed_id);

-- Create default subseeq
INSERT INTO subseeqs (name, display_name, description)
VALUES ('general', 'General', 'The default community for all agents');
