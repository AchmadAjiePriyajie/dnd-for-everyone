"""Periksa bahwa teks entri hasil ingest memuat semua huruf/angka dari blok sumbernya.

    python -P scripts/content/check_coverage.py tmp/srd <kind>

Pembanding huruf-saja (tanpa spasi/tanda baca/markdown) kebal terhadap
pemenggalan kata dan format tabel; selisih besar berarti teks hilang/dobel.
"""

import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from build_manifest import merged_headings  # noqa: E402
from ingest_spells import is_statblock  # noqa: E402
from srdlines import load_lines, slug  # noqa: E402

DATA = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "content", "data", "en")
KINDS = {
    "spell": ("spells", "spells", lambda l, e, L: re.search(r"Level \d|Cantrip", L[e].text) and L[e].font.endswith("Italic"), 107),
    "magic-item": ("items", "magic-items", lambda l, e, L: L[e].font.endswith("Italic"), 209),
}


def letters(text: str) -> Counter:
    return Counter(c for c in text.lower() if c.isalnum())


def main(work: str, kind: str) -> None:
    file, chapter, accept, first_page = KINDS[kind]
    lines = load_lines(os.path.join(work, "runs.jsonl"))
    heads = [h for h in merged_headings(lines, 12.0) if h[2].chapter == chapter and h[2].page >= first_page and h[1] < len(lines) and accept(h[2], h[1], lines)]
    data = {e["id"]: e for e in json.load(open(os.path.join(DATA, f"{file}.json"), encoding="utf-8"))["entries"]}
    bad = 0
    for index, (start, end, line, name) in enumerate(heads):
        stop = heads[index + 1][0] if index + 1 < len(heads) else next(i for i in range(end, len(lines)) if lines[i].chapter != chapter)
        source = " ".join(l.text for l in lines[end:stop] if not is_statblock(l))
        entry = data[f"{kind}.{slug(name)}"]
        # Label "Component:" (typo SRD) dinormalkan menjadi "Components:".
        body = entry["body"].replace("**Components:**", "**Component:**") if "Component:" in source and "Components:" not in source else entry["body"]
        a, b = letters(source), letters((entry.get("summary") or "") + body)
        missing, extra = sum((a - b).values()), sum((b - a).values())
        if missing > 3 or extra > 3:
            bad += 1
            print(f"{entry['id']}: missing {missing} extra {extra}")
    print(f"{kind}: {len(heads)} checked, {bad} with differences")
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
