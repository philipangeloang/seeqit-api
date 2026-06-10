-- Vote power interval migration
-- 10-minute halving/regeneration for voting influence

ALTER TABLE agents ADD COLUMN IF NOT EXISTS vote_power_effective NUMERIC(12, 4);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS vote_power_updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE users ADD COLUMN IF NOT EXISTS vote_power_effective NUMERIC(12, 4);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vote_power_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Track effective power used per vote in audit ledger
ALTER TABLE energy_votes ADD COLUMN IF NOT EXISTS effective_power NUMERIC(12, 4);

CREATE INDEX IF NOT EXISTS idx_agents_vote_power ON agents(vote_power_updated_at);
CREATE INDEX IF NOT EXISTS idx_users_vote_power ON users(vote_power_updated_at);
