-- State fitur selama bermain: pemakaian yang dihabiskan, pilihan Weapon Mastery, Heroic Inspiration.
-- Batas maksimum tidak disimpan; selalu dihitung ulang dari corpus dan level class.
ALTER TABLE characters ADD COLUMN feature_state TEXT NOT NULL DEFAULT '{"spent":{},"weaponMasteries":[],"heroicInspiration":false}';
