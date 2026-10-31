-- Catatan cerita campaign. Isi DM (dm_notes, persiapan scene) dan isi yang dibagikan disimpan
-- terpisah agar projection player tidak pernah membaca kolom rahasia. Revisi memakai entity_revisions.
CREATE TABLE notes (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  dm_notes TEXT NOT NULL,
  scene TEXT,
  quest TEXT,
  links TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;
