-- Bookmark referensi per akun. entry_id = ID corpus SRD atau panduan aplikasi (guide.*).
CREATE TABLE reference_bookmarks (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, entry_id)
) STRICT;
