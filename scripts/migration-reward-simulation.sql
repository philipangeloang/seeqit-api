-- SEEQ reward simulation migration
-- Payout batches, per-content records, total_earned tracking

ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_earned BIGINT DEFAULT 0 NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_earned BIGINT DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS reward_payout_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_date DATE NOT NULL UNIQUE,
  pool_amount BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  content_count INTEGER NOT NULL DEFAULT 0,
  qualifier_count INTEGER NOT NULL DEFAULT 0,
  total_paid BIGINT NOT NULL DEFAULT 0,
  ran_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reward_payouts (
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

CREATE INDEX IF NOT EXISTS idx_reward_payouts_author ON reward_payouts(author_id, author_type);
CREATE INDEX IF NOT EXISTS idx_reward_payouts_content ON reward_payouts(content_id, content_type);
CREATE INDEX IF NOT EXISTS idx_reward_payout_runs_date ON reward_payout_runs(cohort_date DESC);
