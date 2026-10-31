-- Level 2+ yang diterapkan (hasil Hit Point Die, subclass, feat, skill) dan draft level up.
ALTER TABLE characters ADD COLUMN advancements TEXT NOT NULL DEFAULT '[]';
ALTER TABLE characters ADD COLUMN pending_advancement TEXT;
ALTER TABLE characters ADD COLUMN xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0);
ALTER TABLE characters ADD COLUMN levels_granted INTEGER NOT NULL DEFAULT 0 CHECK (levels_granted >= 0);
-- Cara naik level: milestone (DM memberi level) atau XP; level awal untuk karakter baru.
ALTER TABLE campaigns ADD COLUMN advancement_mode TEXT NOT NULL DEFAULT 'milestone' CHECK (advancement_mode IN ('milestone', 'xp'));
ALTER TABLE campaigns ADD COLUMN starting_level INTEGER NOT NULL DEFAULT 1 CHECK (starting_level BETWEEN 1 AND 20);
