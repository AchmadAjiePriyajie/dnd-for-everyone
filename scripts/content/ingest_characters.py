"""Ingest opsi karakter SRD 5.2.1 → packages/content/data/en/characters.json.

    python -P scripts/content/ingest_characters.py tmp/srd

Class (traits, progression, fitur per level), subclass, species, background, feat.
Mekanik di sini netral bahasa (ID/slug/angka); teks lengkap ada di body.
Skema mekaniknya diperketat bersama Task 7–10.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_manifest import merged_headings  # noqa: E402
from srdbody import Words, build_body, is_table_line, table_kind  # noqa: E402
from srdlines import load_lines, slug  # noqa: E402
from srdtables import assemble_table  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "content")
OUT = os.path.join(ROOT, "data", "en", "characters.json")
ABILITY = {"Strength": "str", "Dexterity": "dex", "Constitution": "con", "Intelligence": "int", "Wisdom": "wis", "Charisma": "cha"}
SKILLS = {
    "acrobatics", "animal-handling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation",
    "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight-of-hand", "stealth", "survival",
}


def fields_of(body: str) -> dict[str, str]:
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"^\*\*([^*]+):\*\* (.+)$", body, re.M)}


def abilities_in(text: str) -> list[str]:
    return [ABILITY[w] for w in re.findall(r"Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma", text)]


def skills_in(text: str, issues: list[str], owner: str) -> list[str]:
    names = [slug(n) for n in re.split(r",\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+", re.sub(r"^Choose \d+:\s*", "", text)) if n.strip()]
    bad = [n for n in names if n not in SKILLS]
    if bad:
        issues.append(f"{owner}: skills {bad}")
    return [n for n in names if n in SKILLS]


ITEMS = os.path.join(ROOT, "data", "en", "items.json")
# Nama tampilan sumber → ID equipment, untuk nama yang tidak sama dengan judul entri.
ITEM_ALIASES = {
    "traveler’s clothes": "equipment.clothes-travelers",
    "arrows": "equipment.ammunition",
}
# Item awal yang bukan entri equipment SRD (mis. Spellbook adalah fitur Wizard).
CUSTOM_ITEMS = {"spellbook"}
TOOL_GROUPS = {
    "musical instrument": "musical-instrument",
    "musical instruments": "musical-instrument",
    "gaming set": "gaming-set",
    "artisan’s tools": "artisans-tools",
}


def item_index() -> dict[str, str]:
    """Judul equipment (huruf kecil) → ID; dibaca dari hasil ingest_equipment.py (jalankan lebih dulu)."""
    entries = json.load(open(ITEMS, encoding="utf-8"))["entries"]
    index = {e["name"].lower(): e["id"] for e in entries if e["id"].startswith("equipment.")}
    index.update(ITEM_ALIASES)
    return index


def singular(name: str, index: dict[str, str]) -> str | None:
    for candidate in (name, name[:-1], name[:-2]):
        if candidate in index:
            return index[candidate]
    return None


def equipment_options(text: str, index: dict[str, str], issues: list[str], owner: str) -> list[dict]:
    """"Choose A or B: (A) X, 2 Y, and 15 GP; or (B) 75 GP" → [{option, items, gp}]."""
    text = text.replace("­", "").replace(" ", " ").replace("*", "")
    parts = re.split(r"\(([A-C])\)\s*", text)[1:]
    options = []
    for letter, chunk in zip(parts[0::2], parts[1::2]):
        chunk = re.sub(r";?\s*(or)?\s*$", "", chunk.strip()).strip()
        items, gp = [], 0
        for raw in re.split(r",\s*(?:and\s+)?", chunk):
            raw = raw.strip()
            if not raw:
                continue
            money = re.fullmatch(r"(\d+) GP", raw)
            if money:
                gp = int(money.group(1))
                continue
            qty = re.match(r"^(\d+) (.+)$", raw)
            quantity, name = (int(qty.group(1)), qty.group(2)) if qty else (1, raw)
            note = None
            paren = re.match(r"^(.+?) \(([^)]+)\)$", name)
            if paren:
                name, note = paren.group(1), paren.group(2)
                sheets = re.fullmatch(r"(\d+) sheets", note)
                if sheets:
                    quantity, note = int(sheets.group(1)), None
            key = name.lower()
            if key.startswith("artisan’s tools or musical instrument"):
                items.append({"choice": "tool-proficiency", "quantity": quantity})
                continue
            if note == "same as above" or key.endswith(" of your choice"):
                group = "gaming-set" if key.startswith("gaming set") else "musical-instrument"
                items.append({"choice": group, "quantity": quantity})
                continue
            item_id = singular(key, index)
            if not item_id and key in CUSTOM_ITEMS:
                items.append({"custom": key, "quantity": quantity})
                continue
            if not item_id:
                issues.append(f"{owner}: unknown starting item {raw!r}")
                continue
            item = {"id": item_id, "quantity": quantity}
            if item_id == "equipment.ammunition":
                note = key  # jenis amunisi, mis. "arrows"
            if note:
                item["note"] = note
            items.append(item)
        options.append({"option": letter, "items": items, "gp": gp})
    if not options:
        issues.append(f"{owner}: equipment options {text!r}")
    return options


def tool_proficiencies(text: str, index: dict[str, str], issues: list[str], owner: str) -> dict:
    """"Herbalism Kit" / "Choose 3 Musical Instruments" / "Choose one type of Artisan’s Tools or Musical Instrument"."""
    text = re.sub(r"\s*\(see [^)]*\)", "", text.replace("*", "")).strip()
    choose = re.match(r"^Choose (\d+|one) (?:type of |kind of )?(.+)$", text)
    if choose:
        count = 1 if choose.group(1) == "one" else int(choose.group(1))
        groups = [TOOL_GROUPS.get(part.strip().lower()) for part in re.split(r"\s+or\s+", choose.group(2))]
        if None in groups:
            issues.append(f"{owner}: tool choice {text!r}")
        return {"fixed": [], "choices": [{"count": count, "from": [g for g in groups if g]}]}
    item_id = index.get(text.lower())
    if not item_id:
        issues.append(f"{owner}: tool {text!r}")
    return {"fixed": [item_id] if item_id else [], "choices": []}


def armor_training(text: str) -> list[str]:
    words = (("light", "Light"), ("medium", "Medium"), ("heavy", "Heavy"), ("shield", "Shields"))
    return [kind for kind, word in words if word in text]


def weapon_proficiencies(text: str, issues: list[str], owner: str) -> dict:
    """"Simple and Martial weapons" / "Simple weapons and Martial weapons that have the Finesse or Light property"."""
    limited = re.search(r"Martial weapons that have the (.+?) property", text)
    categories = ["simple"] if "Simple" in text else []
    if "Martial" in text and not limited:
        categories.append("martial")
    result: dict = {"categories": categories}
    if limited:
        result["martialWithProperty"] = [f"rule.property-{slug(p)}" for p in re.split(r"\s+or\s+", limited.group(1))]
    if not categories:
        issues.append(f"{owner}: weapon proficiencies {text!r}")
    return result


def species_traits(body: str) -> dict:
    """Trait species yang memengaruhi angka/pilihan sheet; teks lengkap tetap di body."""
    out: dict = {}
    dark = re.search(r"Darkvision with a range of (\d+) feet", body)
    if dark:
        out["darkvision"] = int(dark.group(1))
    if re.search(r"Hit Point maximum increases by 1, and it increases by 1 again whenever you gain a level", body):
        out["hpPerLevel"] = 1
    keen = re.search(r"proficiency in the (\w+), (\w+), or (\w+) skill", body)
    if keen:
        out["skillChoice"] = {"count": 1, "from": [slug(k) for k in keen.groups()]}
    if re.search(r"You gain proficiency in one skill of your choice", body):
        out["skillChoice"] = {"count": 1}
    if re.search(r"You gain an Origin feat of your choice", body):
        out["originFeatChoice"] = True
    return out


# Efek feat yang memengaruhi angka sheet. Setiap pola wajib cocok dengan teks sumber.
FEAT_EFFECTS = {
    "feat.alert": (r"When you roll Initiative, you can add your Proficiency Bonus", {"initiativeProficiency": True}),
    "feat.tough": (r"increases by an amount equal to twice your character level", {"hpPerLevel": 2}),
    "feat.skilled": (r"proficiency in any combination of three skills or tools", {"proficiencyChoice": 3}),
}


def feat_effects(feat_id: str, body: str, issues: list[str]) -> dict:
    if feat_id not in FEAT_EFFECTS:
        return {}
    pattern, effect = FEAT_EFFECTS[feat_id]
    if not re.search(pattern, body):
        issues.append(f"{feat_id}: effect text changed")
        return {}
    return dict(effect)


PARA = "\n\n"


def relocate_tables(group: list[dict]) -> None:
    """Tabel lebar-penuh di kaki halaman bisa jatuh ke entri yang salah; pindahkan ke
    entri yang teksnya merujuk "<judul> table" (mis. Fiendish Legacies → Tiefling)."""
    for owner in group:
        blocks = owner["body"].split(PARA)
        kept = []
        i = 0
        while i < len(blocks):
            title = re.match(r"^\*\*([^*]+)\*\*$", blocks[i])
            if title and i + 1 < len(blocks) and blocks[i + 1].startswith("| "):
                name = title.group(1)
                mentions = lambda e: f"{name} table" in e["body"]
                if not mentions(owner):
                    target = next((e for e in group if e is not owner and mentions(e)), None)
                    if target:
                        target["body"] += PARA.join(["", f"**{name}**", blocks[i + 1]])
                        i += 2
                        continue
            kept.append(blocks[i])
            i += 1
        owner["body"] = PARA.join(kept)


def main(work: str) -> None:
    lines = load_lines(os.path.join(work, "runs.jsonl"))
    words = Words(lines)
    manifest = {e["id"]: e for e in json.load(open(os.path.join(ROOT, "source", "srd-5.2.1-manifest.json"), encoding="utf-8"))["entries"]}
    issues: list[str] = []
    entries: dict[str, dict] = {}
    items = item_index()
    heads = sorted([h for size in (12.0, 14.0, 18.0) for h in merged_headings(lines, size)], key=lambda h: h[0])

    def add(entry_id: str, name: str, summary: str | None, body: str, mechanics: dict, refs: list[str], section: str, page: int) -> None:
        if entry_id not in manifest:
            issues.append(f"{entry_id}: not in manifest")
        if not body.strip():
            issues.append(f"{entry_id}: empty body")
        entry = {"id": entry_id, "name": name, "body": body, "mechanics": mechanics, "refs": sorted(set(refs)), "source": {"section": section, "page": page}}
        if summary:
            entry["summary"] = summary
        entries[entry_id] = entry

    def chapter_end(start: int, chapter: str) -> int:
        return next(i for i in range(start, len(lines)) if lines[i].chapter != chapter)

    # ------------------------------------------------------------- classes
    class_heads = [h for h in heads if h[2].chapter == "classes" and h[2].size == 18.0]
    for index, (start, end, head, name) in enumerate(class_heads):
        stop = class_heads[index + 1][0] if index + 1 < len(class_heads) else chapter_end(end, "classes")
        sub = next(h for h in heads if start < h[0] < stop and h[2].size == 14.0 and re.match(rf"^{name} Subclass:", h[3]))
        class_id = f"class.{slug(name)}"
        body = build_body(lines[end : sub[0]], words)
        fields = fields_of(body)
        hit_die = re.match(r"^D(\d+)", fields.get("Hit Point Die", ""))
        if not hit_die:
            issues.append(f"{name}: hit point die")
        mechanics: dict = {
            "hitDie": int(hit_die.group(1)) if hit_die else 0,
            "primaryAbilities": abilities_in(fields.get("Primary Ability", "")),
            "savingThrows": abilities_in(fields.get("Saving Throw Proficiencies", "")),
        }
        skill_text = fields.get("Skill Proficiencies", "")
        choose = re.match(r"^Choose (?:any )?(\d+)", skill_text)
        if not choose:
            issues.append(f"{name}: skills {skill_text!r}")
        mechanics["skillChoices"] = {"count": int(choose.group(1)) if choose else 0}
        if "any" not in skill_text.split(":")[0]:
            mechanics["skillChoices"]["from"] = skills_in(skill_text, issues, name)
        mechanics["weaponProficiencies"] = weapon_proficiencies(fields.get("Weapon Proficiencies", ""), issues, name)
        mechanics["armorTraining"] = armor_training(fields.get("Armor Training", ""))
        if "Tool Proficiencies" in fields:
            mechanics["toolProficiencies"] = tool_proficiencies(fields["Tool Proficiencies"], items, issues, name)
        mechanics["startingEquipment"] = equipment_options(fields.get("Starting Equipment", ""), items, issues, name)

        # Tabel progression "<Class> Features".
        title_index = next((i for i in range(end, sub[0]) if lines[i].size == 10.5 and lines[i].text == f"{name} Features"), None)
        if title_index is None:
            issues.append(f"{name}: features table")
        else:
            group = []
            j = title_index + 1
            while j < sub[0] and is_table_line(lines[j]) and table_kind(lines[j]) != "title":
                group.append((table_kind(lines[j]), lines[j]))
                j += 1
            table = assemble_table(group)
            # Header grup "Spell Slots per Spell Level" menempel ke kolom "1".
            columns = [re.sub(r"^.*Spell Slots per Spell Level\W*(\d)$", r"\1", c) for c in table["columns"]]
            progression = []
            for row in table["rows"]:
                values = dict(zip(columns, row))
                level = int(values.pop("Level"))
                pb = int(values.pop("Proficiency Bonus").replace("+", ""))
                features = [slug(f) for f in values.pop("Class Features").split(",") if f.strip() and f.strip() != "—"]
                slots = [values.pop(str(n)) for n in range(1, 10) if str(n) in values]
                step: dict = {"level": level, "proficiencyBonus": pb, "features": features}
                if slots:
                    step["spellSlots"] = [0 if s in ("—", "") else int(s) for s in slots]
                extra = {slug(k): v for k, v in values.items() if v}
                if extra:
                    step["columns"] = extra
                progression.append(step)
            if [p["level"] for p in progression] != list(range(1, 21)):
                issues.append(f"{name}: progression levels {[p['level'] for p in progression]}")
            mechanics["progression"] = progression
        mechanics["features"] = [
            {"level": int(m.group(1)), "id": slug(m.group(2))}
            for h in heads
            if start < h[0] < sub[0] and h[2].size == 12.0
            for m in [re.match(r"^Level (\d+): (.+)$", h[3])]
            if m
        ]
        add(class_id, name, None, body, mechanics, [], "Classes", head.page)

        # Subclass.
        sub_name = re.sub(rf"^{name} Subclass: ?", "", sub[3])
        sub_body = build_body(lines[sub[1] : stop], words)
        sub_features = [
            {"level": int(m.group(1)), "id": slug(m.group(2))}
            for h in heads
            if sub[0] < h[0] < stop and h[2].size == 12.0
            for m in [re.match(r"^Level (\d+): (.+)$", h[3])]
            if m
        ]
        add(f"subclass.{slug(sub_name)}", sub_name, f"{name} Subclass", sub_body, {"class": class_id, "features": sub_features}, [class_id], "Classes", sub[2].page)

    # ------------------------------------------------- backgrounds & species
    origin_heads = [h for h in heads if h[2].chapter == "character-origins"]
    mode = None
    listed: list[tuple[str, tuple]] = []
    for h in origin_heads:
        if h[3] == "Background Descriptions":
            mode = "background"
        elif h[3] in ("Character Species", "Parts of a Species"):
            mode = None
        elif h[3] == "Species Descriptions":
            mode = "species"
        elif mode and h[2].size == 12.0:
            listed.append((mode, h))
    for index, (kind, (start, end, head, name)) in enumerate(listed):
        nxt = next((h[0] for h in origin_heads if h[0] > start and (h[2].size >= 14.0 or (h[2].size == 12.0 and any(h is l[1] for l in listed)))), None)
        stop = nxt if nxt is not None else chapter_end(end, "character-origins")
        body = build_body(lines[end:stop], words)
        fields = fields_of(body)
        if kind == "background":
            feat = re.match(r"^([^(]+?)(?: \((\w+)\))?(?: \(see .*\))?$", fields.get("Feat", ""))
            feat_id = f"feat.{slug(feat.group(1))}" if feat else ""
            tool = fields.get("Tool Proficiency", "")
            mechanics = {
                "abilityScores": abilities_in(fields.get("Ability Scores", "")),
                "feat": feat_id,
                "skills": skills_in(fields.get("Skill Proficiencies", ""), issues, name),
            }
            if feat and feat.group(2):
                mechanics["featOption"] = slug(feat.group(2))
            if f"equipment.{slug(tool)}" in manifest:
                mechanics["tool"] = f"equipment.{slug(tool)}"
            mechanics["toolProficiencies"] = tool_proficiencies(tool, items, issues, name)
            mechanics["startingEquipment"] = equipment_options(fields.get("Equipment", ""), items, issues, name)
            if len(mechanics["abilityScores"]) != 3 or feat_id not in manifest:
                issues.append(f"{name}: background fields {fields}")
            add(f"background.{slug(name)}", name, None, body, mechanics, [feat_id] + ([mechanics["tool"]] if "tool" in mechanics else []), "Character Origins", head.page)
        else:
            sizes = [s.lower() for s in re.findall(r"\b(Tiny|Small|Medium|Large)\b", fields.get("Size", ""))]
            speed = re.match(r"^(\d+) feet", fields.get("Speed", ""))
            creature = slug(fields.get("Creature Type", ""))
            if not sizes or not speed or not creature:
                issues.append(f"{name}: species fields {fields}")
            add(
                f"species.{slug(name)}",
                name,
                None,
                body,
                {"creatureType": creature, "size": sorted(set(sizes), key=["tiny", "small", "medium", "large"].index), "speed": int(speed.group(1)) if speed else 0, **species_traits(body)},
                [],
                "Character Origins",
                head.page,
            )

    relocate_tables([e for e in entries.values() if e["id"].startswith("species.")])

    # ---------------------------------------------------------------- feats
    feat_heads = [h for h in heads if h[2].chapter == "feats"]
    category = None
    for index, (start, end, head, name) in enumerate(feat_heads):
        if head.size == 14.0:
            category = {"Origin Feats": "origin", "General Feats": "general", "Fighting Style Feats": "fighting-style", "Epic Boon Feats": "epic-boon"}.get(name)
            continue
        if head.size != 12.0:
            continue
        stop = feat_heads[index + 1][0] if index + 1 < len(feat_heads) else chapter_end(end, "feats")
        block = lines[end:stop]
        summary = block[0].text if block and block[0].font.endswith("Italic") else None
        pos = 1 if summary else 0
        while summary and pos < len(block) and block[pos].font == block[0].font and summary.count("(") > summary.count(")"):
            summary = f"{summary} {block[pos].text}"
            pos += 1
        body = build_body(block[pos:], words)
        mechanics: dict = {"category": category}
        level = re.search(r"Level (\d+)\+", summary or "")
        if level:
            mechanics["prerequisiteLevel"] = int(level.group(1))
        if "***Repeatable.***" in body:
            mechanics["repeatable"] = True
        mechanics.update(feat_effects(f"feat.{slug(name)}", body, issues))
        if not category or not summary:
            issues.append(f"{name}: feat header {summary!r} {category}")
        add(f"feat.{slug(name)}", name, summary, body, mechanics, [], "Feats", head.page)

    kinds = ("class.", "subclass.", "species.", "background.", "feat.")
    missing = sorted(i for i in manifest if i.startswith(kinds) and i not in entries)
    if missing:
        issues.append(f"missing: {missing}")
    if issues:
        print("\n".join(issues))
        sys.exit(1)
    with open(OUT, "w", encoding="utf-8", newline="\n") as out:
        json.dump({"entries": sorted(entries.values(), key=lambda e: e["id"])}, out, ensure_ascii=False, indent=1)
        out.write("\n")
    print(f"characters: {len(entries)}")


if __name__ == "__main__":
    main(sys.argv[1])
