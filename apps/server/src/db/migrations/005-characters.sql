-- Karakter per campaign. JSON hanya untuk isi wizard/override; ownership dan status kolom biasa.
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  owner_account_id TEXT NOT NULL REFERENCES accounts (id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'final')),
  class_levels TEXT NOT NULL DEFAULT '[]',
  draft TEXT NOT NULL,
  rolls TEXT NOT NULL DEFAULT '[]',
  overrides TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX characters_campaign ON characters (campaign_id);

-- Metode ability score yang diizinkan DM untuk campaign ini.
ALTER TABLE campaigns ADD COLUMN ability_methods TEXT NOT NULL DEFAULT '["standard-array","point-buy","roll"]';
