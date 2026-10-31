"""Ingest Spell Descriptions SRD 5.2.1 → packages/content/data/en/spells.json.

    python -P scripts/content/ingest_spells.py tmp/srd

Membaca runs.jsonl (lihat extract_runs.py).
Gagal keras bila ada header spell yang tidak bisa diurai, agar data tidak diam-diam salah.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_manifest import merged_headings  # noqa: E402
from srdbody import Words, build_body, join_text  # noqa: E402
from srdlines import Line, load_lines, slug  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "content", "data", "en", "spells.json")
FIELD = re.compile(r"^(Casting Time|Range|Components?|Duration):\s*(.*)$")
SCHOOLS = {"abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"}
AREAS = {"cone", "cube", "cylinder", "emanation", "line", "sphere"}


def is_statblock(line: Line) -> bool:
    return (
        line.font.startswith("Optima")
        or line.size == 14.8
        or (line.font.startswith("GillSans") and (line.size in (6.0, 6.8, 9.8) or (line.size == 12.0 and "SemiBold" not in line.font)))
    )


def parse_level(text: str, issues: list[str], name: str) -> tuple[int, str, list[str]]:
    m = re.match(r"^Level (\d) (\w+) \((.+)\)$", text) or re.match(r"^(\w+) Cantrip \((.+)\)$", text)
    if not m:
        issues.append(f"{name}: level line {text!r}")
        return 0, "evocation", []
    if text.startswith("Level"):
        level, school, classes = int(m.group(1)), m.group(2).lower(), m.group(3)
    else:
        level, school, classes = 0, m.group(1).lower(), m.group(2)
    if school not in SCHOOLS:
        issues.append(f"{name}: school {school}")
    return level, school, [f"class.{slug(c)}" for c in classes.split(",")]


def parse_casting(text: str, issues: list[str], name: str) -> tuple[dict, bool]:
    ritual = text.endswith(" or Ritual")
    core = text[: -len(" or Ritual")] if ritual else text
    core = core.split(",")[0].strip()
    # Mode ganda, mis. "Action (Overgrowth) or 8 hours (Enrichment)".
    modes = [re.sub(r"\s*\(.*\)$", "", part).strip() for part in core.split(" or ")]
    parsed = [one_casting(mode) for mode in modes]
    if any(p is None for p in parsed):
        issues.append(f"{name}: casting time {text!r}")
        return {"amount": 1, "unit": "action"}, ritual
    result = dict(parsed[0])
    if len(parsed) > 1:
        result["alternative"] = parsed[1]
    return result, ritual


def one_casting(core: str) -> dict | None:
    simple = {"Action": "action", "Bonus Action": "bonus-action", "Reaction": "reaction"}
    if core in simple:
        return {"amount": 1, "unit": simple[core]}
    m = re.match(r"^(\d+) (minute|hour)s?$", core)
    return {"amount": int(m.group(1)), "unit": m.group(2)} if m else None


def parse_range(text: str, issues: list[str], name: str) -> dict:
    m = re.match(r"^Self \((\d+)-foot(?:-radius)? (\w+)\)$", text)
    if m and m.group(2).lower() in AREAS:
        return {"type": "self", "area": {"shape": m.group(2).lower(), "size": int(m.group(1))}}
    fixed = {"Self": "self", "Touch": "touch", "Sight": "sight", "Unlimited": "unlimited", "Special": "special"}
    if text in fixed:
        return {"type": fixed[text]}
    m = re.match(r"^([\d,]+) (feet|foot|miles?)$", text)
    if m:
        unit = "feet" if m.group(2).startswith("f") else "miles"
        return {"type": unit, "distance": int(m.group(1).replace(",", ""))}
    issues.append(f"{name}: range {text!r}")
    return {"type": "special"}


def parse_components(text: str, issues: list[str], name: str) -> dict:
    head = text.split("(")[0]
    parts = {p.strip() for p in head.split(",") if p.strip()}
    if not parts <= {"V", "S", "M"}:
        issues.append(f"{name}: components {text!r}")
    result = {"verbal": "V" in parts, "somatic": "S" in parts, "material": "M" in parts}
    cost = re.search(r"worth ([\d,]+)\+ GP", text)
    if cost:
        result["materialCost"] = int(cost.group(1).replace(",", ""))
        result["materialConsumed"] = "consumes" in text
    return result


def parse_duration(text: str, issues: list[str], name: str) -> dict:
    m = re.match(r"^Concentration,? up to ", text)
    concentration = bool(m)
    core = text[m.end() :] if m else text
    up_to = core.startswith("Up to ")
    if up_to:
        core = core[len("Up to ") :]
    fixed = {
        "Instantaneous": "instantaneous",
        "Until dispelled": "until-dispelled",
        "Until dispelled or triggered": "until-dispelled-or-triggered",
        "Special": "special",
    }
    if core in fixed:
        return {"type": fixed[core], "concentration": concentration}
    m = re.match(r"^(\d+) (round|minute|hour|day)s?$", core)
    if m:
        timed = {"type": "timed", "amount": int(m.group(1)), "unit": m.group(2), "concentration": concentration}
        if up_to:
            timed["upTo"] = True
        return timed
    issues.append(f"{name}: duration {text!r}")
    return {"type": "special", "concentration": concentration}


def main(work: str) -> None:
    lines = load_lines(os.path.join(work, "runs.jsonl"))
    words = Words(lines)
    heads = [
        (start, end, line, text)
        for start, end, line, text in merged_headings(lines, 12.0)
        if line.chapter == "spells" and end < len(lines) and lines[end].font.endswith("Italic") and re.search(r"Level \d|Cantrip", lines[end].text)
    ]
    issues: list[str] = []
    entries = []
    for index, (start, end, head, name) in enumerate(heads):
        stop = heads[index + 1][0] if index + 1 < len(heads) else next(i for i in range(end, len(lines)) if lines[i].chapter != "spells")
        block = lines[end:stop]
        statblocks = [f"monster.{slug(line.text)}" for line in block if line.size == 14.8]
        block = [line for line in block if not is_statblock(line)]

        pos = 0
        level_text = ""
        while pos < len(block) and block[pos].font.endswith("Italic") and not FIELD.match(block[pos].text):
            level_text = (level_text + " " + block[pos].text).strip()
            pos += 1
        fields: dict[str, str] = {}
        current = None
        while pos < len(block) and (block[pos].font.startswith("GillSans") or FIELD.match(block[pos].text)):
            m = FIELD.match(block[pos].text)
            if m:
                current = "Components" if m.group(1).startswith("Component") else m.group(1)
                fields[current] = m.group(2)
            elif current:
                fields[current] = join_text(fields[current], block[pos].text, words)
            pos += 1
        missing = {"Casting Time", "Range", "Components", "Duration"} - fields.keys()
        if missing:
            issues.append(f"{name}: missing fields {sorted(missing)}")
            continue

        level, school, classes = parse_level(level_text, issues, name)
        casting, ritual = parse_casting(fields["Casting Time"], issues, name)
        mechanics = {
            "level": level,
            "school": school,
            "classes": classes,
            "castingTime": casting,
            "ritual": ritual,
            "range": parse_range(fields["Range"], issues, name),
            "components": parse_components(fields["Components"], issues, name),
            "duration": parse_duration(fields["Duration"], issues, name),
        }
        header = "\n".join(f"**{label}:** {fields[label]}" for label in ("Casting Time", "Range", "Components", "Duration"))
        description = build_body(block[pos:], words)
        if not description:
            issues.append(f"{name}: empty description")
        entries.append(
            {
                "id": f"spell.{slug(name)}",
                "name": name,
                "summary": level_text,
                "body": f"{header}\n\n{description}",
                "mechanics": mechanics,
                "refs": sorted(set(classes + statblocks)),
                "source": {"section": "Spells", "page": head.page},
            }
        )

    if issues:
        print("\n".join(issues))
        sys.exit(1)
    entries.sort(key=lambda e: e["id"])
    with open(OUT, "w", encoding="utf-8", newline="\n") as out:
        json.dump({"entries": entries}, out, ensure_ascii=False, indent=1)
        out.write("\n")
    print(f"spells: {len(entries)}")


if __name__ == "__main__":
    main(sys.argv[1])
