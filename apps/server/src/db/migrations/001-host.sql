-- Identitas host: dibuat sekali dan bertahan selama data directory yang sama dipakai.
CREATE TABLE host_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

INSERT INTO host_meta (key, value) VALUES ('host_id', lower(hex(randomblob(16))));
