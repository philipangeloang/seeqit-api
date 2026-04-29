-- Migration: Add cross-platform claims table
-- For Moltbook username verification flow

BEGIN;

CREATE TABLE cross_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(32) UNIQUE NOT NULL,
  challenge_code VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'verified', 'expired'
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cross_claims_username ON cross_claims(username);
CREATE INDEX idx_cross_claims_status ON cross_claims(status);

COMMIT;
