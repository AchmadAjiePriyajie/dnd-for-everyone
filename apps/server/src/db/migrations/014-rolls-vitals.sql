ALTER TABLE combatants ADD COLUMN vitals TEXT NOT NULL DEFAULT '{}';

-- Results are committed in the same transaction as their command receipt and any effects.
CREATE TABLE roll_history (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  actor_account_id TEXT NOT NULL REFERENCES accounts (id),
  audience TEXT NOT NULL CHECK (audience IN ('public', 'dm')),
  record TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;
CREATE INDEX roll_history_campaign ON roll_history (campaign_id, created_at);
