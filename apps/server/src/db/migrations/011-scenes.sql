-- Metadata asset; isi file disimpan di <dataDir>/assets/<campaign>/<id>, bukan di database
-- dan bukan direktori static. Nama file dibuat server, tidak pernah dari input pengguna.
CREATE TABLE assets (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('dm', 'party')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;

-- Scene: koordinat token dalam satuan sel grid.
CREATE TABLE scenes (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  asset_id TEXT,
  grid TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;

CREATE TABLE tokens (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  character_id TEXT,
  monster_id TEXT,
  owner_account_id TEXT,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  size INTEGER NOT NULL,
  hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
  hp TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;
CREATE INDEX tokens_scene ON tokens (campaign_id, scene_id);
