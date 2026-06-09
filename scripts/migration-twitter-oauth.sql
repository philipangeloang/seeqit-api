-- Twitter OAuth tokens for X automation (callback at /api/callback/twitter)

CREATE TABLE IF NOT EXISTS oauth_states (
  state VARCHAR(128) PRIMARY KEY,
  code_verifier VARCHAR(128) NOT NULL,
  purpose VARCHAR(32) DEFAULT 'twitter_automation' NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS twitter_oauth_tokens (
  id SERIAL PRIMARY KEY,
  twitter_user_id VARCHAR(64) NOT NULL UNIQUE,
  twitter_handle VARCHAR(64),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_twitter_oauth_tokens_handle ON twitter_oauth_tokens(twitter_handle);
