"""Bangun manifest ekspektasi SRD 5.2.1 dari struktur heading/tabel PDF resmi.

    python -I scripts/content/build_manifest.py tmp/srd/runs.jsonl packages/content/source/srd-5.2.1-manifest.json

Manifest hanya berisi daftar entri yang wajib ada (id, nama, bagian, halaman).
Tidak membaca data hasil ingest, sehingga kekurangan corpus tetap terdeteksi.
"""

import json
import re
import sys
from collections import defaultdict

sys.path.insert(0, __import__("os").path.dirname(__file__))
from srdlines import Line, load_lines, slug  # noqa: E402

SHA256 = "8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87"

CHAPTER_TITLES = {
    "playing-the-game": "Playing the Game",
    "character-creation": "Character Creation",
    "classes": "Classes",
    "character-origins": "Character Origins",
    "feats": "Feats",
    "equipment": "Equipment",
    "spells": "Spells",
    "rules-glossary": "Rules Glossary",
    "gameplay-toolbox": "Gameplay Toolbox",
    "magic-items": "Magic Items",
    "monsters-intro": "Monsters",
    "monsters": "Monsters A–Z",
    "animals": "Animals",
}

RULE_SECTION_CHAPTERS = {
    "playing-the-game",
    "character-creation",
    "character-origins",
    "feats",
    "equipment",
    "spells",
    "gameplay-toolbox",
    "magic-items",
    "monsters-intro",
}
NOT_RULE_SECTIONS = {"Spell Descriptions", "Magic Items A–Z"}

COST_SUFFIX = re.compile(r"\s*\((?:[\d,]+ (?:CP|SP|EP|GP|PP)|Varies|Cantrip, 30 GP; Level 1, 50 GP)\)$")


def is_heading(line: Line, size: float) -> bool:
    return line.size == size and "SemiBold" in line.font and all(s[1] == size for s in line.spans)


def merged_headings(lines: list[Line], size: float):
    """Heading yang terbungkus beberapa baris digabung (mis. 'Curses and' + 'Magical Contagions')."""
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if is_heading(line, size):
            text = line.text
            j = i + 1
            while (
                j < len(lines)
                and is_heading(lines[j], size)
                and lines[j].page == line.page
                and lines[j].col == line.col
                and 0 < lines[j - 1].y - lines[j].y <= size * 1.35
            ):
                text += " " + lines[j].text
                j += 1
            if "SC700" in line.font:
                text = text.title()
            out.append((i, j, line, text))
            i = j
        else:
            i += 1
    return out


def table_rows(path: str, page: int, y_from: float, y_to: float) -> list[list[dict]]:
    """Baris tabel lintas kolom: run GillSans pada halaman/y yang sama, urut x."""
    rows = defaultdict(list)
    for raw in open(path, encoding="utf-8"):
        run = json.loads(raw)
        if run["page"] == page and y_to <= run["y"] <= y_from and run["font"].startswith("GillSans"):
            rows[round(run["y"])].append(run)
    return [sorted(rows[y], key=lambda r: r["x"]) for y in sorted(rows, reverse=True)]


def main(runs_path: str, out_path: str) -> None:
    lines = load_lines(runs_path)
    entries: list[dict] = []

    def add(kind: str, name: str, chapter: str, page: int, id_slug: str | None = None) -> None:
        entries.append({"id": f"{kind}.{id_slug or slug(name)}", "name": name, "section": CHAPTER_TITLES[chapter], "page": page})

    h18 = merged_headings(lines, 18.0)
    h14 = merged_headings(lines, 14.0)
    h12 = merged_headings(lines, 12.0)
    h146 = merged_headings(lines, 14.6)

    # Rules Glossary: [Condition] → condition.*, sisanya rule.*.
    for _, _, line, text in h12:
        if line.chapter != "rules-glossary":
            continue
        tag = re.search(r"\s*\[(.+)\]$", text)
        name = text[: tag.start()] if tag else text
        add("condition" if tag and tag.group(1) == "Condition" else "rule", text, line.chapter, line.page, slug(name))

    # Bagian aturan (heading 18pt) di bab non-katalog. Glossary memegang ID kanonik;
    # bagian bab dengan judul sama memakai akhiran "-overview".
    glossary_ids = {e["id"] for e in entries}
    for _, _, line, text in h18:
        if line.chapter in RULE_SECTION_CHAPTERS and text not in NOT_RULE_SECTIONS:
            base = slug(text)
            add("rule", text, line.chapter, line.page, f"{base}-overview" if f"rule.{base}" in glossary_ids else base)

    # Classes dan subclass.
    for idx, end, line, text in h14:
        if line.chapter != "classes":
            continue
        match = re.match(r"^(\w+) Subclass: ?(.*)$", text)
        if match:
            add("subclass", match.group(2), line.chapter, line.page)
    for _, _, line, text in h18:
        if line.chapter == "classes":
            add("class", text, line.chapter, line.page)

    # Origins: background setelah "Background Descriptions", species setelah "Species Descriptions".
    mode = None
    origin_markers = {text: line for _, _, line, text in h14 if line.chapter == "character-origins"}
    for _, _, line, text in sorted(
        [h for h in h12 + h14 + h18 if h[2].chapter == "character-origins"], key=lambda h: h[0]
    ):
        if text == "Background Descriptions":
            mode = "background"
        elif text in ("Character Species", "Parts of a Species"):
            mode = None
        elif text == "Species Descriptions":
            mode = "species"
        elif mode and is_heading(line, 12.0):
            add(mode, text, line.chapter, line.page)
    assert origin_markers, "origin headings not found"

    # Feats.
    for _, _, line, text in h12:
        if line.chapter == "feats":
            add("feat", text, line.chapter, line.page)

    # Equipment: properti senjata/mastery (rule), tools dan gear (heading 12pt).
    section = None
    for idx, _, line, text in sorted([h for h in h12 + h14 + h18 if h[2].chapter == "equipment"], key=lambda h: h[0]):
        if is_heading(line, 18.0) or is_heading(line, 14.0):
            section = text
            continue
        if section == "Properties":
            add("rule", f"{text} (Weapon Property)", line.chapter, line.page, f"property-{slug(text)}")
        elif section == "Mastery Properties":
            add("rule", f"{text} (Mastery Property)", line.chapter, line.page, f"mastery-{slug(text)}")
        elif section in ("Artisan’s Tools", "Other Tools", "Adventuring Gear"):
            add("equipment", COST_SUFFIX.sub("", text), line.chapter, line.page)

    # Equipment dari tabel: senjata, armor, mount, tack/kendaraan, kapal.
    for row in table_rows(runs_path, 91, 715, 45):
        first = row[0]
        if first["x"] > 70 or first["font"] != "GillSans":
            continue
        joined = " ".join(r["text"] for r in row)
        match = re.match(r"^(.+?) (?:\d+d\d+|1) (?:Bludgeoning|Piercing|Slashing)", joined)
        if match:
            add("equipment", match.group(1), "equipment", 91)
    for row in table_rows(runs_path, 92, 420, 175):
        first = row[0]
        if first["font"] != "GillSans" or first["x"] > 80:
            continue
        match = re.match(r"^(.+?) (?:\d|\+)", " ".join(r["text"] for r in row))
        if match:
            add("equipment", match.group(1), "equipment", 92)
    saddle = False
    for row in table_rows(runs_path, 100, 590, 265):
        joined = " ".join(r["text"] for r in row)
        if joined.startswith(("Item ", "Tack, Harness")):
            continue
        if joined == "Saddle":
            saddle = True
            continue
        match = re.match(r"^(.+?) (?:[\d,]+ lb\.|—)", joined)
        if not match:
            continue
        name = match.group(1)
        if saddle and name in ("Exotic", "Military", "Riding"):
            name = f"Saddle, {name}"
        add("equipment", name, "equipment", 100)
    for row in table_rows(runs_path, 101, 710, 610):
        match = re.match(r"^([A-Z][a-z]+(?: Ship)?) [\d½]", " ".join(r["text"] for r in row))
        if match:
            add("equipment", match.group(1), "equipment", 101)

    # Spells: heading 12pt diikuti baris italic level/cantrip.
    for idx, end, line, text in h12:
        if line.chapter == "spells" and end < len(lines):
            nxt = lines[end]
            if nxt.font.endswith("Italic") and re.search(r"Level \d|Cantrip", nxt.text):
                add("spell", text, line.chapter, line.page)

    # Magic items A–Z: heading 12pt (mulai hlm. 209) diikuti baris italic kategori.
    for idx, end, line, text in h12:
        if line.chapter == "magic-items" and line.page >= 209 and end < len(lines) and lines[end].font.endswith("Italic"):
            add("magic-item", text, line.chapter, line.page)

    # Stat block (14.6pt): monster, hewan, makhluk dari spell/magic item.
    for _, _, line, text in h146:
        add("monster", text, line.chapter, line.page)

    # Urutkan stabil per id; tolak ID ganda.
    seen: dict[str, dict] = {}
    for entry in entries:
        if entry["id"] in seen:
            raise SystemExit(f"duplicate id {entry['id']}: {seen[entry['id']]} vs {entry}")
        seen[entry["id"]] = entry
    entries.sort(key=lambda e: e["id"])

    manifest = {
        "source": {
            "title": "System Reference Document 5.2.1",
            "version": "5.2.1",
            "license": "CC-BY-4.0",
            "url": "https://www.dndbeyond.com/srd",
            "sha256": SHA256,
            "pages": 364,
        },
        "entries": entries,
    }
    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        json.dump(manifest, out, ensure_ascii=False, indent=1)
        out.write("\n")
    counts = defaultdict(int)
    for entry in entries:
        counts[entry["id"].split(".")[0]] += 1
    print(json.dumps(counts), len(entries))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
