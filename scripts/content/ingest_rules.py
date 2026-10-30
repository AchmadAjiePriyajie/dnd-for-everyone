"""Ingest aturan SRD 5.2.1 → packages/content/data/en/rules.json.

    python -P scripts/content/ingest_rules.py tmp/srd

Isi: entri Rules Glossary (rule.* dan condition.*), bagian bab (heading 18pt)
sebagai rule.*, dan properti/mastery senjata. Bagian bab tidak menyalin teks
entri lain yang berdiri sendiri (gear, tool, background, species, feat).
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_manifest import CHAPTER_TITLES, NOT_RULE_SECTIONS, RULE_SECTION_CHAPTERS, merged_headings  # noqa: E402
from srdbody import Words, build_body  # noqa: E402
from srdlines import load_lines, slug  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "content")
OUT = os.path.join(ROOT, "data", "en", "rules.json")
# Bagian bab yang berakhir sebelum daftar entri berdiri sendiri.
STOP_AT = {"Background Descriptions", "Species Descriptions", "Origin Feats"}
SUMMARY_TABLE_PAGES = {91, 95}
STANDALONE_SECTIONS = {"Properties", "Mastery Properties", "Artisan’s Tools", "Other Tools", "Adventuring Gear"}


def main(work: str) -> None:
    lines = load_lines(os.path.join(work, "runs.jsonl"))
    words = Words(lines)
    manifest = {e["id"]: e for e in json.load(open(os.path.join(ROOT, "source", "srd-5.2.1-manifest.json"), encoding="utf-8"))["entries"]}
    issues: list[str] = []
    entries: dict[str, dict] = {}
    heads = sorted(
        [h for size in (12.0, 14.0, 18.0) for h in merged_headings(lines, size)],
        key=lambda h: h[0],
    )

    def add(entry_id: str, name: str, summary: str | None, body: str, section: str, page: int) -> None:
        if entry_id not in manifest:
            issues.append(f"{entry_id}: not in manifest")
        if not body.strip():
            issues.append(f"{entry_id}: empty body")
        entry = {"id": entry_id, "name": name, "body": body, "source": {"section": section, "page": page}}
        if summary:
            entry["summary"] = summary
        entries[entry_id] = entry

    # --- Rules Glossary.
    glossary = [h for h in heads if h[2].chapter == "rules-glossary" and h[2].size == 12.0]
    for index, (start, end, head, text) in enumerate(glossary):
        stop = glossary[index + 1][0] if index + 1 < len(glossary) else next(i for i in range(end, len(lines)) if lines[i].chapter != "rules-glossary")
        tag = re.search(r"\s*\[(.+)\]$", text)
        name = text[: tag.start()] if tag else text
        kind = "condition" if tag and tag.group(1) == "Condition" else "rule"
        add(f"{kind}.{slug(name)}", name, f"[{tag.group(1)}]" if tag else None, build_body(lines[end:stop], words), "Rules Glossary", head.page)

    # --- Bagian bab (heading 18pt).
    glossary_ids = {f"rule.{slug(re.sub(r'\s*\[.+\]$', '', h[3]))}" for h in glossary}
    sections = [h for h in heads if h[2].size == 18.0 and h[2].chapter in RULE_SECTION_CHAPTERS]
    for index, (start, end, head, text) in enumerate(sections):
        if text in NOT_RULE_SECTIONS:
            continue
        chapter = head.chapter
        nxt = next((h for h in heads if h[0] > start and h[2].size == 18.0), None)
        stop = nxt[0] if nxt and lines[nxt[0]].chapter == chapter else next(i for i in range(end, len(lines)) if lines[i].chapter != chapter)
        block = []
        skip_until = None
        current_section = text
        for i in range(end, stop):
            line = lines[i]
            heading = next((h for h in heads if h[0] == i), None)
            if heading and heading[3] in STOP_AT:
                break
            if heading and heading[2].size in (14.0, 18.0):
                current_section = heading[3]
                skip_until = None
            if heading and heading[2].size == 12.0 and chapter == "equipment" and current_section in STANDALONE_SECTIONS:
                # Entri sendiri (properti, tool, gear): lewati sampai heading berikutnya.
                skip_until = next((h[0] for h in heads if h[0] > i), stop)
            # Tabel ringkasan (Weapons hlm. 91, Adventuring Gear hlm. 95) milik bagian
            # ini walau tercetak di tengah daftar entri.
            if skip_until is not None and i < skip_until and line.page not in SUMMARY_TABLE_PAGES:
                continue
            block.append(line)
        base = slug(text)
        entry_id = f"rule.{base}-overview" if f"rule.{base}" in glossary_ids else f"rule.{base}"
        add(entry_id, text, None, build_body(block, words), CHAPTER_TITLES[chapter], head.page)

    # --- Properti dan mastery senjata.
    current_section = None
    equipment_heads = [h for h in heads if h[2].chapter == "equipment"]
    for index, (start, end, head, text) in enumerate(equipment_heads):
        if head.size in (14.0, 18.0):
            current_section = text
            continue
        if current_section not in ("Properties", "Mastery Properties"):
            continue
        stop = equipment_heads[index + 1][0]
        prefix, label = ("property", "Weapon Property") if current_section == "Properties" else ("mastery", "Mastery Property")
        block = [line for line in lines[end:stop] if line.page not in SUMMARY_TABLE_PAGES]
        add(f"rule.{prefix}-{slug(text)}", text, label, build_body(block, words), "Equipment", head.page)

    missing = sorted(i for i in manifest if (i.startswith("rule.") or i.startswith("condition.")) and i not in entries)
    if missing:
        issues.append(f"missing: {missing}")
    if issues:
        print("\n".join(issues))
        sys.exit(1)
    with open(OUT, "w", encoding="utf-8", newline="\n") as out:
        json.dump({"entries": sorted(entries.values(), key=lambda e: e["id"])}, out, ensure_ascii=False, indent=1)
        out.write("\n")
    print(f"rules: {len(entries)}")


if __name__ == "__main__":
    main(sys.argv[1])
