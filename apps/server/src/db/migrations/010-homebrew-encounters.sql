-- Homebrew per campaign: usulan player menunggu persetujuan DM; mekanik tervalidasi skema corpus.
CREATE TABLE homebrew (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  mechanics TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
  author_account_id TEXT NOT NULL REFERENCES accounts (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;

-- Template encounter (persiapan DM), terpisah dari instance combat.
CREATE TABLE encounter_templates (
  id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  template TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, id)
) STRICT;
