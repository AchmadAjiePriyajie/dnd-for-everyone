-- Akun per instalasi server. username_key = username huruf kecil untuk keunikan.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  locale TEXT CHECK (locale IN ('en', 'id')),
  is_server_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_server_owner IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

-- Hanya satu pemilik server (bootstrap sekali).
CREATE UNIQUE INDEX accounts_single_owner ON accounts (is_server_owner) WHERE is_server_owner = 1;

-- Sesi opaque: hanya hash token disimpan; dapat dicabut.
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE INDEX auth_sessions_account ON auth_sessions (account_id);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  ruleset TEXT NOT NULL DEFAULT 'srd-5.2.1-2024',
  dm_account_id TEXT NOT NULL REFERENCES accounts (id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE campaign_members (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  role TEXT NOT NULL CHECK (role IN ('dm', 'player')),
  joined_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (campaign_id, account_id)
) STRICT;
CREATE INDEX campaign_members_account ON campaign_members (account_id);

-- Satu DM pemilik per campaign.
CREATE UNIQUE INDEX campaign_members_single_dm ON campaign_members (campaign_id) WHERE role = 'dm';

-- Undangan hanya memberi role player; kode disimpan sebagai hash.
CREATE TABLE campaign_invites (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role = 'player'),
  created_by TEXT NOT NULL REFERENCES accounts (id),
  created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE INDEX campaign_invites_campaign ON campaign_invites (campaign_id);
