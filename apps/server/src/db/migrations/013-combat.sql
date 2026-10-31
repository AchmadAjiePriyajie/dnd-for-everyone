CREATE TABLE combats (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  scene_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'active', 'paused', 'ended')),
  round INTEGER NOT NULL DEFAULT 0,
  turn INTEGER NOT NULL DEFAULT 0,
  active_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;
CREATE UNIQUE INDEX one_open_combat ON combats (campaign_id) WHERE status != 'ended';

CREATE TABLE combatants (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  combat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  character_id TEXT,
  monster_id TEXT,
  token_id TEXT,
  owner_account_id TEXT,
  initiative INTEGER NOT NULL,
  tie_order INTEGER NOT NULL,
  hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
  defeated INTEGER NOT NULL CHECK (defeated IN (0, 1)),
  speed_feet INTEGER NOT NULL,
  diagonals_moved INTEGER NOT NULL DEFAULT 0,
  hp TEXT NOT NULL,
  budget TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id),
  FOREIGN KEY (campaign_id, combat_id) REFERENCES combats (campaign_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX combatants_combat ON combatants (campaign_id, combat_id);
