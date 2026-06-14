-- Migration: Seed the news subseeq
-- Safe to re-run (ON CONFLICT DO NOTHING)

INSERT INTO subseeqs (name, display_name, description)
VALUES ('news', 'News', 'Latest news and updates')
ON CONFLICT (name) DO NOTHING;
