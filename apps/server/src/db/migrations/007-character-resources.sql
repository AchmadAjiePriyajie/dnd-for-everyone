-- Inventory/koin, spell, slot, HP dan Hit Point Dice karakter final. Batas selalu dihitung ulang dari corpus.
ALTER TABLE characters ADD COLUMN resources TEXT NOT NULL DEFAULT '{}';
-- Siapa yang boleh menyelesaikan rest: 'dm' (hanya DM) atau 'players' (pemilik karakter juga).
ALTER TABLE campaigns ADD COLUMN rest_policy TEXT NOT NULL DEFAULT 'dm' CHECK (rest_policy IN ('dm', 'players'));
