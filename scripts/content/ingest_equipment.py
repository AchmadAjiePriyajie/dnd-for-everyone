"""Ingest Equipment SRD 5.2.1 → packages/content/data/en/items.json (bagian equipment).

    python -P scripts/content/ingest_equipment.py tmp/srd

Tool/gear dari entri berjudul; senjata, armor, mount, tack dan kapal dari tabel.
Entri magic-item di file yang sama dipertahankan.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_manifest import COST_SUFFIX, merged_headings  # noqa: E402
from srdbody import Words, build_body, is_table_line, table_kind  # noqa: E402
from srdlines import Line, load_lines, slug  # noqa: E402
from srdtables import assemble_table, cells_by_gap  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "content")
OUT = os.path.join(ROOT, "data", "en", "items.json")
GEAR_TABLE_PAGE = 95
ABILITIES = {"Strength": "str", "Dexterity": "dex", "Constitution": "con", "Intelligence": "int", "Wisdom": "wis", "Charisma": "cha"}
DAMAGE = {"Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Piercing", "Poison", "Psychic", "Radiant", "Slashing", "Thunder"}
PROPERTIES = {"ammunition", "finesse", "heavy", "light", "loading", "range", "reach", "thrown", "two-handed", "versatile"}
MASTERIES = {"cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"}


def parse_cost(text: str, issues: list[str], name: str) -> dict | None:
    text = text.strip()
    if text in ("—", "Varies"):
        return None
    m = re.match(r"^([\d,]+) (CP|SP|EP|GP|PP)$", text)
    if not m:
        issues.append(f"{name}: cost {text!r}")
        return None
    return {"amount": int(m.group(1).replace(",", "")), "unit": m.group(2).lower()}


def parse_weight(text: str, issues: list[str], name: str) -> float | None:
    text = re.sub(r"\s*\((?:full)\)$", "", text.strip())
    if text in ("—", "Varies"):
        return None
    m = re.match(r"^([\d,]+)?(?: ?(½|¼))? ?lb\.$", text) or re.match(r"^(\d+)/(\d+) lb\.$", text)
    if not m:
        issues.append(f"{name}: weight {text!r}")
        return None
    if "/" in text:
        return int(m.group(1)) / int(m.group(2))
    whole = int(m.group(1).replace(",", "")) if m.group(1) else 0
    frac = {"½": 0.5, "¼": 0.25}.get(m.group(2) or "", 0)
    return whole + frac


def table_after(lines: list[Line], title: str, page: int) -> list[Line]:
    """Baris tabel setelah judul tabel tertentu di halaman tertentu."""
    for index, line in enumerate(lines):
        is_title = line.size == 10.5 and line.text == title
        is_header = line.size == 9.2 and line.text.startswith(title)
        if line.page == page and (is_title or is_header):
            out = [line]
            j = index + 1
            while j < len(lines) and is_table_line(lines[j]) and table_kind(lines[j]) != "title":
                out.append(lines[j])
                j += 1
            return out
    raise SystemExit(f"table {title!r} not found on page {page}")


def rows_of(table_lines: list[Line]) -> tuple[list[str], list[list[str]]]:
    table = assemble_table([(table_kind(l), l) for l in table_lines])
    if not table:
        raise SystemExit(f"table {table_lines[0].text!r} has no header")
    return table["columns"], table["rows"]


def field_block(rows: list[tuple[str, str]]) -> str:
    return "\n".join(f"**{label}:** {value}" for label, value in rows)


def main(work: str) -> None:
    lines = load_lines(os.path.join(work, "runs.jsonl"))
    words = Words(lines)
    manifest = {e["id"]: e for e in json.load(open(os.path.join(ROOT, "source", "srd-5.2.1-manifest.json"), encoding="utf-8"))["entries"]}
    issues: list[str] = []
    entries: dict[str, dict] = {}

    def add(name: str, page: int, summary: str | None, body: str, mechanics: dict, refs: list[str]) -> None:
        entry_id = f"equipment.{slug(name)}"
        if entry_id not in manifest:
            issues.append(f"{name}: not in manifest")
        entry = {"id": entry_id, "name": name, "body": body, "mechanics": mechanics, "refs": sorted(set(refs)), "source": {"section": "Equipment", "page": page}}
        if summary:
            entry["summary"] = summary
        entries[entry_id] = entry

    # Berat gear dari tabel Adventuring Gear (hlm. 95, dua tabel berdampingan).
    gear_weights: dict[str, str] = {}
    for line in lines:
        if line.page == GEAR_TABLE_PAGE and line.font == "GillSans" and line.size == 9.5:
            for keep in (lambda s: s[3] < 300, lambda s: s[3] >= 300):
                side = [s for s in line.spans if keep(s)]
                if not side:
                    continue
                cells = cells_by_gap(Line(line.page, line.col, line.y, side[0][3], side))
                if len(cells) == 3:
                    gear_weights[cells[0][1]] = cells[1][1]

    # --- Tool dan gear berjudul.
    heads = sorted(
        [h for size in (12.0, 14.0, 18.0) for h in merged_headings(lines, size) if h[2].chapter == "equipment"],
        key=lambda h: h[0],
    )
    section = None
    for index, (start, end, head, text) in enumerate(heads):
        if head.size in (14.0, 18.0):
            section = text
            continue
        if section not in ("Artisan’s Tools", "Other Tools", "Adventuring Gear"):
            continue
        stop = heads[index + 1][0] if index + 1 < len(heads) else end
        # Hlm. 95 = tabel ringkasan "Adventuring Gear" (milik rule.adventuring-gear),
        # tercetak di antara entri Ammunition dan Antitoxin.
        block = [line for line in lines[end:stop] if line.page != GEAR_TABLE_PAGE]
        name = COST_SUFFIX.sub("", text)
        cost_text = text[len(name) :].strip(" ()")
        fields: list[tuple[str, str]] = []
        rest: list[Line] = []
        for line in block:
            first = line.spans[0]
            if first[0] == "GillSans-SemiBold" and first[1] == 9.5 and first[2].endswith(":"):
                spans = line.spans
                i = 0
                while i < len(spans):
                    label = spans[i][2].rstrip(":")
                    value = []
                    i += 1
                    while i < len(spans) and not (spans[i][0] == "GillSans-SemiBold" and spans[i][2].endswith(":")):
                        value.append(spans[i][2])
                        i += 1
                    fields.append((label, " ".join(value)))
            elif fields and not rest and line.font == "GillSans" and line.size == 9.5 and line.x > block[0].x + 4:
                label, value = fields[-1]
                from srdbody import join_text

                fields[-1] = (label, join_text(value, line.text, words))
            else:
                rest.append(line)
        body_parts = [field_block(fields)] if fields else []
        described = build_body(rest, words)
        if described:
            body_parts.append(described)
        mechanics: dict = {"cost": parse_cost(cost_text, issues, name) if cost_text not in ("Varies", "Cantrip, 30 GP; Level 1, 50 GP") else None}
        field_map = dict(fields)
        weight_text = field_map.get("Weight") or gear_weights.get(name)
        mechanics["weight"] = parse_weight(weight_text, issues, name) if weight_text else None
        if section in ("Artisan’s Tools", "Other Tools"):
            mechanics["category"] = "tool"
            ability = field_map.get("Ability", "")
            if ability in ABILITIES:
                mechanics["tool"] = {"ability": ABILITIES[ability]}
                if section == "Artisan’s Tools":
                    mechanics["tool"]["artisan"] = True
            elif ability:
                issues.append(f"{name}: tool ability {ability!r}")
        elif name.endswith("Pack"):
            mechanics["category"] = "pack"
        elif name in ("Arcane Focus", "Druidic Focus", "Holy Symbol"):
            mechanics["category"] = "focus"
        elif name == "Ammunition":
            mechanics["category"] = "ammunition"
        else:
            mechanics["category"] = "gear"
        if not body_parts:
            issues.append(f"{name}: empty body")
        add(name, head.page, None, "\n\n".join(body_parts), {"category": mechanics.pop("category"), **mechanics}, [])

    # --- Senjata.
    columns, rows = rows_of(table_after(lines, "Name Damage", 91))
    group = None
    for row in rows:
        if not any(row[1:]):
            group = row[0]
            continue
        name, damage, props, mastery, weight, cost = row
        category, kind = group.split(" ")[0].lower(), group.split(" ")[1].lower()
        m = re.match(r"^(\d+d\d+|1) (\w+)$", damage)
        if not m or m.group(2) not in DAMAGE:
            issues.append(f"{name}: damage {damage!r}")
            continue
        weapon: dict = {"category": category, "type": kind, "damage": {"dice": m.group(1), "type": m.group(2).lower()}, "properties": []}
        for prop in re.split(r",\s*(?![^()]*\))", props):
            prop = prop.strip()
            if prop in ("—", ""):
                continue
            pm = re.match(r"^([A-Za-z-]+(?: [A-Za-z]+)?)(?: \((.+)\))?$", prop)
            key = slug(pm.group(1)) if pm else ""
            if key not in PROPERTIES:
                issues.append(f"{name}: property {prop!r}")
                continue
            weapon["properties"].append(f"rule.property-{key}")
            detail = pm.group(2) or ""
            rm = re.search(r"Range (\d+)/(\d+)", detail)
            if rm:
                weapon["range"] = {"normal": int(rm.group(1)), "long": int(rm.group(2))}
            am = re.search(r"; (\w+)\)?$", detail + ")")
            if key == "ammunition" and am:
                weapon["ammunition"] = slug(am.group(1))
            if key == "versatile":
                weapon["versatile"] = detail
        if slug(mastery) not in MASTERIES:
            issues.append(f"{name}: mastery {mastery!r}")
            continue
        weapon["mastery"] = f"rule.mastery-{slug(mastery)}"
        body = field_block([(columns[1], damage), (columns[2], props), (columns[3], mastery), (columns[4], weight), (columns[5], cost)])
        add(name, 91, group[:-1] if group.endswith("s") else group, body, {"category": "weapon", "cost": parse_cost(cost, issues, name), "weight": parse_weight(weight, issues, name), "weapon": weapon}, weapon["properties"] + [weapon["mastery"]])

    # --- Armor.
    columns, rows = rows_of(table_after(lines, "Armor", 92))
    group = None
    for row in rows:
        if not any(row[1:]):
            group = row[0]
            continue
        name, ac, strength, stealth, weight, cost = row
        category = group.split(" ")[0].lower()
        times = re.findall(r"(\d+) Minutes?", group)
        don, doff = (int(times[0]), int(times[-1])) if times else (0, 0)
        am = re.match(r"^\+?(\d+)(?: \+ Dex modifier(?: \(max (\d+)\))?)?$", ac)
        if not am:
            issues.append(f"{name}: ac {ac!r}")
            continue
        armor: dict = {
            "category": "shield" if category == "shield" else category,
            "baseAc": int(am.group(1)),
            "dexCap": None if "Dex" not in ac else (int(am.group(2)) if am.group(2) else None),
            "stealthDisadvantage": stealth == "Disadvantage",
            "donMinutes": don,
            "doffMinutes": doff,
        }
        if "Dex" not in ac:
            # Heavy armor: tanpa Dex; shield: bonus tambahan, batas Dex tidak berlaku.
            armor["dexCap"] = None if category == "shield" else 0
        if strength.startswith("Str "):
            armor["strength"] = int(strength[4:])
        body = field_block([(columns[1], ac), (columns[2], strength), (columns[3], stealth), (columns[4], weight), (columns[5], cost)])
        add(name, 92, group, body, {"category": "armor", "cost": parse_cost(cost, issues, name), "weight": parse_weight(weight, issues, name), "armor": armor}, [])

    # --- Mount.
    columns, rows = rows_of(table_after(lines, "Mounts and Other Animals", 100))
    for name, capacity, cost in rows:
        body = field_block([(columns[1], capacity), (columns[2], cost)])
        cap = int(capacity.replace(",", "").replace(" lb.", ""))
        add(name, 100, "Mounts and Other Animals", body, {"category": "mount", "cost": parse_cost(cost, issues, name), "weight": None, "mount": {"carryingCapacity": cap}}, [f"monster.{slug(name.split(',')[0])}"] if f"monster.{slug(name.split(',')[0])}" in manifest else [])

    # --- Tack, harness, kendaraan tarik.
    columns, rows = rows_of(table_after(lines, "Tack, Harness, and Drawn Vehicles", 100))
    group = None
    for row in rows:
        name, weight, cost = row
        if not weight and not cost:
            group = name
            continue
        full = f"{group}, {name}" if group == "Saddle" and name in ("Exotic", "Military", "Riding") else name
        category = "service" if "per day" in name else "vehicle" if name in ("Carriage", "Cart", "Chariot", "Sled", "Wagon") else "tack"
        body = field_block([(columns[1], weight), (columns[2], cost)])
        add(full, 100, "Tack, Harness, and Drawn Vehicles", body, {"category": category, "cost": parse_cost(cost, issues, full), "weight": parse_weight(weight, issues, full)}, [])

    # --- Kapal.
    columns, rows = rows_of(table_after(lines, "Airborne and Waterborne Vehicles", 101))
    for row in rows:
        name = row[0]
        values = dict(zip(columns, row))
        vehicle: dict = {}
        speed = re.match(r"^(\d+)?(½)? mph$", values["Speed"])
        if speed:
            vehicle["speedMph"] = (int(speed.group(1)) if speed.group(1) else 0) + (0.5 if speed.group(2) else 0)
        for key, column in (("crew", "Crew"), ("passengers", "Passengers"), ("ac", "AC"), ("hp", "HP"), ("damageThreshold", "Damage Threshold")):
            if values[column] not in ("—", ""):
                vehicle[key] = int(values[column].replace(",", ""))
        cargo = values["Cargo (Tons)"]
        if cargo not in ("—", ""):
            vehicle["cargoTons"] = 0.5 if cargo == "1/2" else float(cargo)
        body = field_block([(c, values[c]) for c in columns[1:]])
        add(name, 101, "Airborne and Waterborne Vehicles", body, {"category": "vehicle", "cost": parse_cost(values["Cost"], issues, name), "weight": None, "vehicle": vehicle}, [])

    missing = sorted(i for i in manifest if i.startswith("equipment.") and i not in entries)
    if missing:
        issues.append(f"missing equipment: {missing}")
    if issues:
        print("\n".join(issues))
        sys.exit(1)

    existing = json.load(open(OUT, encoding="utf-8"))["entries"] if os.path.exists(OUT) else []
    kept = [e for e in existing if not e["id"].startswith("equipment.")]
    merged = sorted(kept + list(entries.values()), key=lambda e: e["id"])
    with open(OUT, "w", encoding="utf-8", newline="\n") as out:
        json.dump({"entries": merged}, out, ensure_ascii=False, indent=1)
        out.write("\n")
    print(f"equipment: {len(entries)}")


if __name__ == "__main__":
    main(sys.argv[1])
