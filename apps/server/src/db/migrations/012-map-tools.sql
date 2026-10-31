-- Kabut manual per scene: persegi yang diungkap DM.
ALTER TABLE scenes ADD COLUMN fog TEXT NOT NULL DEFAULT '{"enabled":false,"revealed":[]}';

-- Penanda area of effect di peta (bukan ping: ping tidak disimpan).
CREATE TABLE map_markers (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  owner_account_id TEXT NOT NULL,
  marker TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;
CREATE INDEX map_markers_scene ON map_markers (campaign_id, scene_id);
