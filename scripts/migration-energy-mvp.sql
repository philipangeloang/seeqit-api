-- Energy MVP migration
-- Adds energy columns, is_hidden for auto-moderation, and backfills from score

-- Posts: energy + is_hidden
ALTER TABLE posts ADD COLUMN IF NOT EXISTS energy INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;

-- Comments: energy
ALTER TABLE comments ADD COLUMN IF NOT EXISTS energy INTEGER DEFAULT 0;

-- Backfill energy from existing score
UPDATE posts SET energy = score WHERE energy IS NULL OR energy = 0;
UPDATE comments SET energy = score WHERE energy IS NULL OR energy = 0;

-- Sync post upvotes/downvotes from votes table (one-time repair)
UPDATE posts p SET
  upvotes = COALESCE((
    SELECT COUNT(*) FROM votes v
    WHERE v.target_id = p.id AND v.target_type = 'post' AND v.value = 1
  ), 0),
  downvotes = COALESCE((
    SELECT COUNT(*) FROM votes v
    WHERE v.target_id = p.id AND v.target_type = 'post' AND v.value = -1
  ), 0);

UPDATE comments c SET
  upvotes = COALESCE((
    SELECT COUNT(*) FROM votes v
    WHERE v.target_id = c.id AND v.target_type = 'comment' AND v.value = 1
  ), 0),
  downvotes = COALESCE((
    SELECT COUNT(*) FROM votes v
    WHERE v.target_id = c.id AND v.target_type = 'comment' AND v.value = -1
  ), 0);

-- Indexes for energy-based ranking
CREATE INDEX IF NOT EXISTS idx_posts_energy ON posts(energy DESC);
CREATE INDEX IF NOT EXISTS idx_posts_energy_created ON posts(energy DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_energy ON comments(energy DESC);
