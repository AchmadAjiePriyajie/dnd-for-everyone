-- Play sessions (Task 19): links to live scene/combat records plus recap, journal and rule notes.
CREATE TABLE play_sessions (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'ended')),
  record TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id),
  UNIQUE (campaign_id, number)
) STRICT;
