"""Ingest stat block SRD 5.2.1 → packages/content/data/en/monsters.json.

    python -P scripts/content/ingest_monsters.py tmp/srd

Mencakup Monsters A–Z, Animals, dan makhluk di dalam spell/magic item.
Gagal keras bila header stat block tidak bisa diurai.
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

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "content")
OUT = os.path.join(ROOT, "data", "en", "monsters.json")
SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"]
TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"]
DAMAGE = {"acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"}
CONDITIONS = {"blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"}
ABILITIES = {"str", "dex", "con", "int", "wis", "cha"}
LABELS = ("AC", "HP", "Speed", "Skills", "Resistances", "Vulnerabilities", "Immunities", "Gear", "Senses", "Languages", "CR")
# Gear tanpa padanan equipment SRD (mis. "Wand" generik): tetap tertulis di body.
GENERIC_GEAR = {"Wand"}
# Frasa deskriptif pada daftar resistensi/kekebalan (bukan tipe tunggal): teks tetap di body,
# tidak dijadikan mekanik terstruktur.
DESCRIPTIVE_DEFENSES = {"Half-Dragon", "Rakshasa", "Archmage", "Vampire Familiar"}
SECTION_CHAPTER = {"monsters": "Monsters", "animals": "Animals", "spells": "Spells", "magic-items": "Magic Items"}


def num(text: str) -> int:
    return int(text.replace("−", "-").replace("+", "").replace(",", ""))


class Parser:
    def __init__(self, name: str, issues: list[str]):
        self.name = name
        self.issues = issues

    def fail(self, what: str, text: str) -> None:
        self.issues.append(f"{self.name}: {what} {text!r}")

    def type_line(self, text: str) -> dict:
        head, _, alignment = text.rpartition(", ")
        result: dict = {"alignment": slug(alignment)}
        swarm = re.match(r"^(\w+) Swarm of (\w+) (\w+)$", head)
        if swarm:
            result["size"] = [swarm.group(1).lower()]
            result["swarmOf"] = swarm.group(2).lower()
            kind = swarm.group(3).lower().rstrip("s")
            result["creatureTypes"] = [kind]
            return result
        words = head.split(" ")
        sizes = []
        while words and (words[0].lower() in SIZES or words[0] == "or"):
            if words[0] != "or":
                sizes.append(words[0].lower())
            words.pop(0)
        if words and words[0] == "Smaller":
            # "Huge or Smaller": semua ukuran sampai batas tersebut.
            sizes = SIZES[: SIZES.index(sizes[0]) + 1]
            words.pop(0)
        result["size"] = sizes
        rest = " ".join(words)
        tags = re.findall(r"\(([^)]+)\)", rest)
        rest = re.sub(r"\s*\([^)]*\)", "", rest)
        kinds = [k.lower() for k in re.findall(r"[A-Za-z]+", rest) if k.lower() in TYPES]
        result["creatureTypes"] = kinds
        tag_slugs = [slug(t) for t in tags if t != "Your Choice"]
        if tag_slugs:
            result["tags"] = tag_slugs
        if not sizes or not kinds:
            self.fail("type", text)
        return result

    def speed(self, text: str) -> tuple[dict, bool]:
        speeds = {}
        hover = "(hover)" in text
        # Kecepatan bersyarat ("40 ft. (bear form only)") tidak menimpa nilai dasar;
        # teks lengkap tetap di body.
        for part in [p.strip() for p in text.replace("(hover)", "").split(",") if p.strip()]:
            conditional = "(" in part
            part = re.sub(r"\s*\(.*\)$", "", part)
            m = re.match(r"^(?:((?:Burrow|Climb|Fly|Swim)(?: or (?:Burrow|Climb|Fly|Swim))?) )?(\d+) ft\.$", part)
            if not m:
                self.fail("speed", text)
                continue
            for mode in (m.group(1) or "walk").split(" or "):
                key = mode.lower()
                if conditional and key in speeds:
                    continue
                speeds.setdefault(key, int(m.group(2)))
        return speeds, hover

    def damage_list(self, text: str, what: str) -> list[str]:
        items = [slug(t) for t in re.split(r",|\band\b", text) if t.strip()]
        bad = [i for i in items if i not in DAMAGE]
        if bad and self.name not in DESCRIPTIVE_DEFENSES:
            self.fail(what, text)
        return [i for i in items if i in DAMAGE]

    def immunities(self, text: str) -> dict:
        damage, conditions = [], []
        for raw in [t.strip() for t in re.split(r"[;,]|\band\b", text) if t.strip()]:
            item = slug(raw)
            if item in DAMAGE:
                damage.append(item)
            elif item in CONDITIONS:
                conditions.append(f"condition.{item}")
            elif self.name not in DESCRIPTIVE_DEFENSES:
                self.fail("immunity", text)
        return {"damage": damage, "conditions": conditions}

    def senses(self, text: str) -> tuple[dict, int | None]:
        senses, passive = {}, None
        for part in [p.strip() for p in text.split(";") if p.strip()]:
            for sense in [s.strip() for s in part.split(",") if s.strip()]:
                m = re.match(r"^(Blindsight|Darkvision|Tremorsense|Truesight) (\d+) ft\.", sense)
                if m:
                    senses[m.group(1).lower()] = int(m.group(2))
                    continue
                m = re.match(r"^Passive Perception (\d+)", sense)
                if m:
                    passive = int(m.group(1))
                    continue
                self.fail("sense", text)
        return senses, passive

    def skills(self, text: str) -> dict:
        out = {}
        for part in [p.strip() for p in text.split(",") if p.strip()]:
            m = re.match(r"^(.+?) ([+−-]\d+)$", part)
            if not m:
                self.fail("skill", text)
                continue
            out[slug(m.group(1))] = num(m.group(2))
        return out


def stat_lines(block: list) -> tuple[list, list]:
    """Pisahkan baris header (sebelum bagian Traits/Actions) dari baris badan."""
    for index, line in enumerate(block):
        if line.font == "GillSans" and line.size == 12.0:
            return block[:index], block[index:]
    return block, []


def main(work: str) -> None:
    lines = load_lines(os.path.join(work, "runs.jsonl"))
    words = Words(lines)
    manifest_ids = {e["id"] for e in json.load(open(os.path.join(ROOT, "source", "srd-5.2.1-manifest.json"), encoding="utf-8"))["entries"]}
    heads = merged_headings(lines, 14.8)
    issues: list[str] = []
    entries = []
    for start, end, head, name in heads:
        stop = end
        while stop < len(lines) and is_statblock(lines[stop]) and lines[stop].size != 14.8 and not (lines[stop].size == 18.0):
            stop += 1
        block = lines[end:stop]
        parser = Parser(name, issues)
        header, rest = stat_lines(block)
        summoned = head.chapter in ("spells", "magic-items")

        pos = 0
        type_text = ""
        while pos < len(header) and header[pos].font == "Optima-Italic":
            type_text = f"{type_text} {header[pos].text}".strip()
            pos += 1
        fields: dict[str, str] = {}
        abilities: dict[str, int] = {}
        saves: dict[str, int] = {}
        mods: dict[str, int] = {}
        current = None
        for line in header[pos:]:
            if line.font.startswith("GillSans"):
                for m in re.finditer(r"\b(Str|Dex|Con|Int|Wis|Cha)\s+(\d+)\s+([+−-]\d+)\s+([+−-]?\d+)", line.text, re.I):
                    key = m.group(1).lower()
                    abilities[key] = int(m.group(2))
                    mods[key] = num(m.group(3))
                    saves[key] = num(m.group(4))
                    if m.group(4)[0].isdigit():
                        # Tanda hilang di sumber (Young White Dragon: Int "2", MOD −2):
                        # nilai sama dengan MOD → ikuti tanda MOD; selain itu gagal keras.
                        if abs(saves[key]) != abs(mods[key]):
                            parser.fail("unsigned save", m.group(0))
                        saves[key] = mods[key]
                    if mods[key] != (abilities[key] - 10) // 2:
                        parser.fail("modifier", m.group(0))
                continue
            label = next((l for l in LABELS if line.text == l or line.text.startswith(l + " ")), None)
            if label and line.spans[0][0].startswith("Optima-Bold"):
                current = label
                fields[label] = line.text[len(label) :].strip()
            elif current:
                fields[current] = f"{fields[current]} {line.text}".strip()

        mechanics = parser.type_line(type_text)
        if summoned:
            mechanics["summoned"] = True
        ac = re.match(r"^(\d+)(?: Initiative ([+−-]\d+) \((\d+)\))?", fields.get("AC", ""))
        if ac and not ac.group(2) and not summoned:
            parser.fail("initiative", fields.get("AC", ""))
        if ac:
            mechanics["ac"] = int(ac.group(1))
            if ac.group(2):
                mechanics["initiative"] = num(ac.group(2))
        elif not summoned:
            parser.fail("ac", fields.get("AC", ""))
        hp = re.match(r"^(\d+) \((\d+d\d+(?: [+−-] \d+)?)\)$", fields.get("HP", ""))
        if hp:
            mechanics["hp"] = {"average": int(hp.group(1)), "formula": hp.group(2).replace("−", "-")}
        elif not summoned:
            parser.fail("hp", fields.get("HP", ""))
        mechanics["speed"], hover = parser.speed(fields.get("Speed", ""))
        if hover:
            mechanics["hover"] = True
        if set(abilities) != ABILITIES:
            parser.fail("abilities", str(abilities))
        mechanics["abilities"] = abilities
        mechanics["saves"] = saves
        if "Skills" in fields:
            mechanics["skills"] = parser.skills(fields["Skills"])
        if "Vulnerabilities" in fields:
            mechanics["vulnerabilities"] = parser.damage_list(fields["Vulnerabilities"], "vulnerability")
        if "Resistances" in fields:
            mechanics["resistances"] = parser.damage_list(fields["Resistances"], "resistance")
        if "Immunities" in fields:
            mechanics["immunities"] = parser.immunities(fields["Immunities"])
        gear_refs = []
        if "Gear" in fields:
            for item in [re.sub(r"\s*\(.*\)$", "", g).strip() for g in fields["Gear"].split(",")]:
                base = slug(item)
                candidates = [base, re.sub(r"es$", "", base), re.sub(r"s$", "", base)]
                ref = next((f"equipment.{c}" for c in candidates if f"equipment.{c}" in manifest_ids), None)
                if ref:
                    gear_refs.append(ref)
                elif item not in GENERIC_GEAR:
                    parser.fail("gear", item)
            mechanics["gear"] = gear_refs
        senses, passive = parser.senses(fields.get("Senses", ""))
        mechanics["senses"] = senses
        if passive is None:
            parser.fail("passive perception", fields.get("Senses", ""))
        mechanics["passivePerception"] = passive or 0
        cr = re.match(r"^(\d+(?:/\d+)?) \((?:XP ([\d,]+)|([\d,]+) XP)(?:,? or ([\d,]+) in lair)?; PB \+(\d+)\)$", fields.get("CR", ""))
        if cr:
            mechanics["cr"] = cr.group(1)
            mechanics["xp"] = num(cr.group(2) or cr.group(3))
            if cr.group(4):
                mechanics["xpInLair"] = num(cr.group(4))
            mechanics["proficiencyBonus"] = int(cr.group(5))
        elif not summoned:
            parser.fail("cr", fields.get("CR", ""))

        ability_rows = ["| | " + " | ".join(a.title() for a in ("str", "dex", "con", "int", "wis", "cha")) + " |", "|---|---|---|---|---|---|---|"]
        for label, source in (("Score", abilities), ("Mod", None), ("Save", saves)):
            if label == "Mod":
                cells = [f"{mods.get(a, 0):+d}".replace("-", "−") for a in ("str", "dex", "con", "int", "wis", "cha")]
            else:
                cells = [f"{source.get(a, 0):+d}".replace("-", "−") if label == "Save" else str(source.get(a, "")) for a in ("str", "dex", "con", "int", "wis", "cha")]
            ability_rows.append(f"| {label} | " + " | ".join(cells) + " |")
        top = [f"**{l}** {fields[l]}" for l in ("AC", "HP", "Speed") if l in fields]
        top = [line.replace(" Initiative ", " **Initiative** ", 1) if line.startswith("**AC**") else line for line in top]
        bottom = [f"**{l}** {fields[l]}" for l in LABELS[3:] if l in fields]
        body_parts = ["\n".join(top), "\n".join(ability_rows), "\n".join(bottom)]
        actions = build_body(rest, words)
        if actions:
            body_parts.append(actions)
        section = SECTION_CHAPTER.get(head.chapter, "Monsters")
        entries.append(
            {
                "id": f"monster.{slug(name)}",
                "name": name,
                "summary": type_text,
                "body": "\n\n".join(p for p in body_parts if p),
                "mechanics": mechanics,
                "refs": sorted(set(mechanics.get("immunities", {}).get("conditions", []) + gear_refs)),
                "source": {"section": section, "page": head.page},
            }
        )

    if issues:
        print("\n".join(issues))
        sys.exit(1)
    entries.sort(key=lambda e: e["id"])
    with open(OUT, "w", encoding="utf-8", newline="\n") as out:
        json.dump({"entries": entries}, out, ensure_ascii=False, indent=1)
        out.write("\n")
    print(f"monsters: {len(entries)}")


if __name__ == "__main__":
    main(sys.argv[1])
