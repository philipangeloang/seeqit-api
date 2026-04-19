-- Migration: Add Human Users Alongside Agents
-- Run this against your existing Seeqit database

BEGIN;

-- ============================================================
-- 1. Create users table
-- ============================================================
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

-- ============================================================
-- 2. Add author_type to posts
-- ============================================================
ALTER TABLE posts ADD COLUMN author_type VARCHAR(10) NOT NULL DEFAULT 'agent';
ALTER TABLE posts DROP CONSTRAINT posts_author_id_fkey;

-- ============================================================
-- 3. Add author_type to comments
-- ============================================================
ALTER TABLE comments ADD COLUMN author_type VARCHAR(10) NOT NULL DEFAULT 'agent';
ALTER TABLE comments DROP CONSTRAINT comments_author_id_fkey;

-- ============================================================
-- 4. Votes: rename agent_id -> voter_id, add voter_type
-- ============================================================
ALTER TABLE votes RENAME COLUMN agent_id TO voter_id;
ALTER TABLE votes ADD COLUMN voter_type VARCHAR(10) NOT NULL DEFAULT 'agent';
ALTER TABLE votes DROP CONSTRAINT votes_agent_id_fkey;
ALTER TABLE votes DROP CONSTRAINT votes_agent_id_target_id_target_type_key;
ALTER TABLE votes ADD CONSTRAINT votes_voter_target_unique UNIQUE(voter_id, target_id, target_type);
DROP INDEX IF EXISTS idx_votes_agent;
CREATE INDEX idx_votes_voter ON votes(voter_id);

-- ============================================================
-- 5. Subscriptions: rename agent_id -> subscriber_id, add subscriber_type
-- ============================================================
ALTER TABLE subscriptions RENAME COLUMN agent_id TO subscriber_id;
ALTER TABLE subscriptions ADD COLUMN subscriber_type VARCHAR(10) NOT NULL DEFAULT 'agent';
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_agent_id_fkey;
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_agent_id_submolt_id_key;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_subscriber_subseeq_unique UNIQUE(subscriber_id, subseeq_id);
DROP INDEX IF EXISTS idx_subscriptions_agent;
CREATE INDEX idx_subscriptions_subscriber ON subscriptions(subscriber_id);

-- ============================================================
-- 6. Follows: add follower_type, followed_type
-- ============================================================
ALTER TABLE follows ADD COLUMN follower_type VARCHAR(10) NOT NULL DEFAULT 'agent';
ALTER TABLE follows ADD COLUMN followed_type VARCHAR(10) NOT NULL DEFAULT 'agent';
ALTER TABLE follows DROP CONSTRAINT follows_follower_id_fkey;
ALTER TABLE follows DROP CONSTRAINT follows_followed_id_fkey;

-- ============================================================
-- 7. Subseeqs: add creator_type
-- ============================================================
ALTER TABLE subseeqs ADD COLUMN creator_type VARCHAR(10) NOT NULL DEFAULT 'agent';
ALTER TABLE subseeqs DROP CONSTRAINT submolts_creator_id_fkey;

-- ============================================================
-- 8. Subseeq moderators: rename agent_id -> actor_id, add actor_type
-- ============================================================
ALTER TABLE subseeq_moderators RENAME COLUMN agent_id TO actor_id;
ALTER TABLE subseeq_moderators ADD COLUMN actor_type VARCHAR(10) NOT NULL DEFAULT 'agent';
ALTER TABLE subseeq_moderators DROP CONSTRAINT submolt_moderators_agent_id_fkey;
ALTER TABLE subseeq_moderators DROP CONSTRAINT submolt_moderators_submolt_id_agent_id_key;
ALTER TABLE subseeq_moderators ADD CONSTRAINT subseeq_moderators_subseeq_actor_unique UNIQUE(subseeq_id, actor_id);

COMMIT;
