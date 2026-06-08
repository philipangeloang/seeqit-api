-- SEEQ weighted voting migration
-- Simulated wallet balances, per-vote energy tracking, audit ledger

-- Wallet balances on actors
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wallet_balance BIGINT DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance BIGINT DEFAULT 0 NOT NULL;

-- Per-vote applied energy (signed contribution for flip/remove)
ALTER TABLE votes ADD COLUMN IF NOT EXISTS energy_applied INTEGER DEFAULT 0 NOT NULL;

-- Backfill: MVP votes were 1:1 with value
UPDATE votes SET energy_applied = value WHERE energy_applied = 0 AND value IS NOT NULL;

-- Energy votes audit ledger (create or extend existing Neon table)
CREATE TABLE IF NOT EXISTS energy_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voter_id UUID NOT NULL,
  voter_type VARCHAR(10) NOT NULL DEFAULT 'agent',
  target_id UUID NOT NULL,
  target_type VARCHAR(10) NOT NULL,
  energy_amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE energy_votes ADD COLUMN IF NOT EXISTS voter_weight NUMERIC(10, 2) NOT NULL DEFAULT 1;
ALTER TABLE energy_votes ADD COLUMN IF NOT EXISTS author_bonus NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE energy_votes ADD COLUMN IF NOT EXISTS vote_value SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE energy_votes ADD COLUMN IF NOT EXISTS action VARCHAR(20) NOT NULL DEFAULT 'upvoted';

CREATE INDEX IF NOT EXISTS idx_energy_votes_target ON energy_votes(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_energy_votes_voter_time ON energy_votes(voter_id, created_at DESC);

-- Admin wallet adjustment ledger
CREATE TABLE IF NOT EXISTS wallet_ledger (
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

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_actor ON wallet_ledger(actor_id, actor_type);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_created ON wallet_ledger(created_at DESC);

-- Reconcile energy totals from votes (ensures consistency after backfill)
UPDATE posts p SET energy = COALESCE((
  SELECT SUM(v.energy_applied) FROM votes v
  WHERE v.target_id = p.id AND v.target_type = 'post'
), 0);

UPDATE comments c SET energy = COALESCE((
  SELECT SUM(v.energy_applied) FROM votes v
  WHERE v.target_id = c.id AND v.target_type = 'comment'
), 0);
