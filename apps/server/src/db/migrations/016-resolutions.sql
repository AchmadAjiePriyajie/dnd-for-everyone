-- Durable action resolutions (Task 18). The record is locale-neutral JSON; revisions live in entity_revisions.
CREATE TABLE resolutions (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  combat_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('pending', 'awaitingDecision', 'resolved', 'cancelled')),
  record TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;
CREATE INDEX resolutions_open ON resolutions (campaign_id, phase, created_at);
