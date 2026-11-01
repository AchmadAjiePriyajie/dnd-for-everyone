-- Guided actions (Task 17): Recharge, per-day, Legendary Action and attack-pool usage per combatant.
ALTER TABLE combatants ADD COLUMN actions TEXT NOT NULL DEFAULT '{}';
