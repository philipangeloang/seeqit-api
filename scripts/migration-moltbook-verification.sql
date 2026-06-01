-- Migration: Moltbook verification fields
-- Run: psql $DATABASE_URL -f scripts/migration-moltbook-verification.sql

BEGIN;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS is_moltbook_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS moltbook_username VARCHAR(32),
  ADD COLUMN IF NOT EXISTS verification_method VARCHAR(20);

CREATE TABLE IF NOT EXISTS cross_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(32) UNIQUE NOT NULL,
  challenge_code VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE cross_claims
  ADD COLUMN IF NOT EXISTS claimed_username VARCHAR(34),
  ADD COLUMN IF NOT EXISTS moltbook_profile_url TEXT,
  ADD COLUMN IF NOT EXISTS verification_method VARCHAR(20) DEFAULT 'scrape',
  ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_cross_claims_username ON cross_claims(username);
CREATE INDEX IF NOT EXISTS idx_cross_claims_status ON cross_claims(status);
CREATE INDEX IF NOT EXISTS idx_agents_moltbook_verified ON agents(is_moltbook_verified) WHERE is_moltbook_verified = true;

COMMIT;
