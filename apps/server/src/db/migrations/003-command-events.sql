-- Log event per campaign; sequence monoton per campaign.
CREATE TABLE campaign_events (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor_account_id TEXT REFERENCES accounts (id),
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, sequence)
) STRICT;

-- Revision per entity target; dikelola dispatcher untuk expectedRevision.
CREATE TABLE entity_revisions (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, target_id)
) STRICT;

-- Receipt idempotency per actor + campaign + requestId.
CREATE TABLE command_receipts (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  actor_account_id TEXT NOT NULL REFERENCES accounts (id),
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, actor_account_id, request_id)
) STRICT;
