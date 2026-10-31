-- Campaigns created from the original tutorial adventure (Task 20); the guide follows each viewer's locale.
CREATE TABLE tutorial_campaigns (
  campaign_id TEXT NOT NULL PRIMARY KEY REFERENCES campaigns (id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'id')),
  created_at TEXT NOT NULL
) STRICT;
