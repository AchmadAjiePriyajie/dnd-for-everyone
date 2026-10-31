"""Gabungkan batch terjemahan ID ke packages/content/data/id/<file>.json.

    python -P scripts/content/merge_translation.py <file> <batch.json> [<batch.json> ...]

Batch: [{"id", "name", "summary"?, "body"}]. Script menambahkan `sourceHash`
dari teks EN saat ini (sama persis dengan sourceHash() di catalog.ts) dan
menolak batch bila ID tidak dikenal, summary tidak sepadan, atau angka/dadu
berbeda dari sumber. Panduan gaya: packages/content/source/translation-id.md.
"""

import hashlib
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "content", "data")


def source_hash(name: str, summary: str | None, body: str) -> str:
    payload = json.dumps([name, summary, body], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def number_signature(text: str) -> str:
    text = re.sub(r"\(ref:[^)]*\)", "", text)
    tokens = re.findall(r"\d+d\d+|\d+(?:[.,]\d+)*", text)
    return " ".join(sorted(t.replace(".", "").replace(",", "") for t in tokens))


def table_shape(body: str) -> list[int]:
    return [line.count("|") for line in body.split("\n") if line.startswith("|")]


def main(file: str, batches: list[str]) -> None:
    en = {e["id"]: e for e in json.load(open(os.path.join(ROOT, "en", f"{file}.json"), encoding="utf-8"))["entries"]}
    out_path = os.path.join(ROOT, "id", f"{file}.json")
    current = {e["id"]: e for e in json.load(open(out_path, encoding="utf-8"))["entries"]} if os.path.exists(out_path) else {}
    problems: list[str] = []
    added = 0
    for batch in batches:
        for item in json.load(open(batch, encoding="utf-8")):
            source = en.get(item["id"])
            if not source:
                problems.append(f"{item['id']}: unknown id")
                continue
            if ("summary" in source) != ("summary" in item):
                problems.append(f"{item['id']}: summary presence differs from EN")
            en_text = f"{source.get('summary', '')}\n{source['body']}"
            id_text = f"{item.get('summary', '')}\n{item['body']}"
            if number_signature(en_text) != number_signature(id_text):
                problems.append(f"{item['id']}: numbers differ\n  en: {number_signature(en_text)}\n  id: {number_signature(id_text)}")
            if table_shape(source["body"]) != table_shape(item["body"]):
                problems.append(f"{item['id']}: table shape differs")
            record = {"id": item["id"], "name": item["name"]}
            if "summary" in item:
                record["summary"] = item["summary"]
            record["body"] = item["body"]
            record["sourceHash"] = source_hash(source["name"], source.get("summary"), source["body"])
            current[item["id"]] = record
            added += 1
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        json.dump({"entries": sorted(current.values(), key=lambda e: e["id"])}, out, ensure_ascii=False, indent=1)
        out.write("\n")
    print(f"{file}: +{added}, total {len(current)}/{len(en)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
