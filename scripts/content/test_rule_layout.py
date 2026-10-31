"""Regression fixtures from SRD 5.2.1 (CC-BY-4.0)."""

import json
from pathlib import Path
import tempfile
import unittest

from extract_runs import merge_full_width_tables
from ingest_rules import build_section_body
from srdbody import Words, build_body
from srdlines import Line, load_lines


def line(text, *, font="Cambria", size=10.0, y=500, x=63):
    return Line(5, 0, y, x, [(font, size, text, x, x + 100)])


class RuleLayoutTests(unittest.TestCase):
    def test_skills_table_keeps_example_uses_with_each_skill(self):
        runs = json.loads(Path(__file__).with_name("fixtures").joinpath("skills-runs.json").read_text(encoding="utf-8"))
        merge_full_width_tables(runs)
        runs.sort(key=lambda r: (r["col"], -r["y"], r["x"]))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runs.jsonl"
            path.write_text("\n".join(json.dumps(r) for r in runs), encoding="utf-8")
            lines = load_lines(str(path))
        body = build_body(lines, Words(lines))
        self.assertIn("| Acrobatics | Dexterity | Stay on your feet in a tricky situation, or perform an acrobatic stunt. |", body)
        self.assertIn("| Survival | Wisdom | Follow tracks, forage, find a trail, or avoid natural hazards. |", body)
        self.assertEqual(20, sum(row.startswith("|") for row in body.splitlines()))

    def test_travel_table_keeps_six_columns_and_complete_footnotes(self):
        runs = json.loads(Path(__file__).with_name("fixtures").joinpath("travel-terrain-runs.json").read_text(encoding="utf-8"))
        merge_full_width_tables(runs)
        runs.sort(key=lambda r: (r["col"], -r["y"], r["x"]))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runs.jsonl"
            path.write_text("\n".join(json.dumps(r) for r in runs), encoding="utf-8")
            lines = load_lines(str(path))
        body = build_body(lines, Words(lines))
        self.assertIn("| Terrain | Maximum Pace | Encounter Distance | Foraging DC | Navigation DC | Search DC |", body)
        self.assertIn("| Arctic | Fast* | 6d6 × 10 feet | 20 | 10 | 10 |", body)
        self.assertIn("| Waterborne | Special† | 6d6 × 10 feet | 15 | 10 | 15 |", body)
        self.assertIn("keep up a Fast pace in Arctic terrain.", body)
        self.assertIn("vehicle carrying them; see “Vehicles.”", body)
        self.assertEqual(13, sum(row.startswith("|") for row in body.splitlines()))

    def test_sidebar_does_not_split_rhythm_sentence(self):
        lines = [line("This pattern holds whether the"), line("General rule.", font="GillSans", size=9.0, y=480), line("adventurers are talking or fighting.", y=450)]
        body = build_section_body("Rhythm of Play", lines, Words(lines))
        self.assertIn("whether the adventurers are talking or fighting.", body)
        self.assertTrue(body.endswith("> General rule."))

    def test_separate_right_table_title_prevents_full_width_merge(self):
        runs = json.loads(Path(__file__).with_name("fixtures").joinpath("skills-runs.json").read_text(encoding="utf-8"))
        runs.append({"page": 9, "col": 1, "x": 313.5, "x1": 400, "y": 733.8, "font": "GillSans-SemiBold", "size": 10.5, "text": "Other Table"})
        merge_full_width_tables(runs)
        self.assertEqual(18, len({r["y"] for r in runs if r["col"] == 1 and r["size"] == 9.5}))

    def test_right_table_continuing_above_left_header_stays_separate(self):
        # SRD page 69: Level 5 Sorcerer Spells (left) starts beside Level 8's last rows (right).
        def run(col, x, y, text, font="GillSans", size=9.5):
            return {"page": 69, "col": col, "x": x, "x1": x + 40, "y": y, "font": font, "size": size, "text": text}
        runs = [
            run(0, 67, 482.4, "Spell", "GillSans-SemiBold", 9.2), run(0, 189, 482.4, "School", "GillSans-SemiBold", 9.2),
            run(1, 317, 497.3, "Incendiary Cloud", "GillSans-Italic"), run(1, 440, 497.3, "Conjuration"),
            run(1, 317, 482.2, "Power Word Stun", "GillSans-Italic"), run(1, 440, 482.2, "Enchantment"),
            run(0, 67, 467.1, "Animate Objects", "GillSans-Italic"), run(0, 189, 467.1, "Transmutation"),
            run(1, 317, 467.1, "Sunburst", "GillSans-Italic"), run(1, 440, 467.1, "Evocation"),
        ]
        merge_full_width_tables(runs)
        self.assertEqual(6, sum(r["col"] == 1 for r in runs))

    def test_higher_level_table_does_not_split_character_creation(self):
        lines = [line("Use the rules provided"), line("Starting Equipment", font="GillSans-SemiBold", size=10.5, y=480), line("Level", font="GillSans-SemiBold", size=9.2, y=465), line("2–4", font="GillSans", size=9.5, y=450), line("in the Level Advancement section.", y=430)]
        body = build_section_body("Starting at Higher Levels", lines, Words(lines))
        self.assertIn("rules provided in the Level Advancement section.", body)
        self.assertLess(body.index("Advancement"), body.index("Starting Equipment"))


if __name__ == "__main__":
    unittest.main()
