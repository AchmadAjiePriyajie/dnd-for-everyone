"""Ingest Magic Items A–Z SRD 5.2.1 → packages/content/data/en/items.json (bagian magic-item).

    python -P scripts/content/ingest_magic_items.py tmp/srd

Entri equipment di file yang sama dipertahankan (ditulis oleh ingest_equipment.py).
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_manifest import merged_headings  # noqa: E402
from ingest_spells import is_statblock  # noqa: E402
from srdbody import Words, build_body  # noqa: E402
from srdlines import load_lines, slug  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "content", "data", "en", "items.json")
CATEGORIES = {
    "Armor": "armor",
    "Potion": "potion",
    "Ring": "ring",
    "Rod": "rod",
    "Scroll": "scroll",
    "Staff": "staff",
    "Wand": "wand",
    "Weapon": "weapon",
    "Wondrous Item": "wondrous-item",
}
RARITIES = [("Very Rare", "very-rare"), ("Uncommon", "uncommon"), ("Common", "common"), ("Rare", "rare"), ("Legendary", "legendary"), ("Artifact", "artifact")]
CLASSES = {"Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"}


def unfinished(text: str) -> bool:
    return text.endswith((",", " or", "(")) or text.count("(") > text.count(")")


def parse_category(text: str, issues: list[str], name: str) -> dict:
    head = re.split(r"[,(]", text, maxsplit=1)[0].strip()
    category = CATEGORIES.get(head)
    if not category:
        issues.append(f"{name}: category {text!r}")
        category = "wondrous-item"
    rest = text[len(head) :]
    rest_no_scope = re.sub(r"^\s*\([^)]*\)", "", rest) if category in ("armor", "weapon") else rest
    found = set()
    scan = rest_no_scope
    for label, value in RARITIES:
        if label in scan:
            found.add(value)
            scan = scan.replace(label, "")
    if "Rarity Varies" in text:
        rarity = "varies"
    elif len(found) == 1:
        rarity = found.pop()
    elif len(found) > 1:
        rarity = "varies"
    else:
        issues.append(f"{name}: rarity {text!r}")
        rarity = "common"
    mechanics: dict = {"category": category, "rarity": rarity, "attunement": "Requires Attunement" in text}
    by = re.search(r"Requires Attunement by (?:a |an )?([^)]+)\)", text)
    if by:
        classes = [c.strip() for c in re.split(r",| or ", by.group(1).replace("a ", "")) if c.strip()]
        ids = [f"class.{slug(c)}" for c in classes if c in CLASSES]
        if ids:
            mechanics["attunementBy"] = ids
    return mechanics


def main(work: str) -> None:
    lines = load_lines(os.path.join(work, "runs.jsonl"))
    words = Words(lines)
    heads = [
        (start, end, line, text)
        for start, end, line, text in merged_headings(lines, 12.0)
        if line.chapter == "magic-items" and line.page >= 209 and end < len(lines) and lines[end].font.endswith("Italic")
    ]
    issues: list[str] = []
    entries = []
    for index, (start, end, head, name) in enumerate(heads):
        stop = heads[index + 1][0] if index + 1 < len(heads) else next(i for i in range(end, len(lines)) if lines[i].chapter != "magic-items")
        block = lines[end:stop]
        statblocks = [f"monster.{slug(line.text)}" for line in block if line.size == 14.8]
        block = [line for line in block if not is_statblock(line)]
        category_text = block[0].text
        pos = 1
        while pos < len(block) and unfinished(category_text) and block[pos].font == block[0].font:
            category_text = f"{category_text} {block[pos].text}"
            pos += 1
        mechanics = parse_category(category_text, issues, name)
        body = build_body(block[pos:], words)
        charges = re.search(r"\bhas (\d+) charges\b", body)
        if charges:
            mechanics["charges"] = int(charges.group(1))
        if not body:
            issues.append(f"{name}: empty body")
        entries.append(
            {
                "id": f"magic-item.{slug(name)}",
                "name": name,
                "summary": category_text,
                "body": body,
                "mechanics": mechanics,
                "refs": sorted(set(mechanics.get("attunementBy", []) + statblocks)),
                "source": {"section": "Magic Items", "page": head.page},
            }
        )
    if issues:
        print("\n".join(issues))
        sys.exit(1)

    existing = json.load(open(OUT, encoding="utf-8"))["entries"] if os.path.exists(OUT) else []
    kept = [e for e in existing if not e["id"].startswith("magic-item.")]
    merged = sorted(kept + entries, key=lambda e: e["id"])
    with open(OUT, "w", encoding="utf-8", newline="\n") as out:
        json.dump({"entries": merged}, out, ensure_ascii=False, indent=1)
        out.write("\n")
    print(f"magic items: {len(entries)}")


if __name__ == "__main__":
    main(sys.argv[1])
