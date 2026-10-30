"""Ekstrak run teks SRD 5.2.1 beserta halaman, posisi, font dan ukuran.

Pemakaian (tooling dev, butuh `pymupdf`):
    python -P scripts/content/extract_runs.py <srd.pdf> <out.jsonl>

Output satu run per baris: {"page", "col", "x", "x1", "y", "font", "size", "text"}.
`y` diukur dari bawah halaman (baseline). Run dipecah pada jarak horizontal
lebar (batas sel tabel), sehingga setiap sel punya posisi x sendiri. Urutan
baca: per halaman, kolom kiri lalu kanan, atas ke bawah. Header/footer dibuang.
PDF sumber tidak ikut ke repo/build (folder referensi diabaikan Git).
"""

import hashlib
import json
import sys

EXPECTED_SHA256 = "8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87"


def font_name(name: str) -> str:
    return name.split("+", 1)[-1]


def pieces(span: dict) -> list[dict]:
    """Pecah span pada celah antar-karakter yang jauh lebih lebar dari spasi biasa.

    Teks tabel/field (GillSans kecil) dipecah per kata agar sel yang rapat tetap
    bisa dipetakan ke kolom header.
    """
    size = span["size"]
    per_word = font_name(span["font"]).startswith("GillSans") and size <= 10.5
    out = []
    current = None
    last_x1 = None
    for char in span["chars"]:
        x0, _, x1, _ = char["bbox"]
        c = char["c"]
        gap = x0 - last_x1 if last_x1 is not None else 0
        if current is not None and (gap > size * 0.9 or (per_word and c == " ")):
            out.append(current)
            current = None
        if current is None:
            if c == " ":
                last_x1 = x1
                continue
            current = {"x": x0, "y": char["origin"][1], "text": ""}
        current["text"] += c
        current["x1"] = x1
        last_x1 = x1
    if current is not None:
        out.append(current)
    return out


def is_table_run(run: dict) -> bool:
    return run["font"].startswith("GillSans") and run["size"] <= 10.5


def merge_full_width_tables(runs: list[dict]) -> None:
    """Tabel selebar halaman: pindahkan sel di kolom kanan ke kolom kiri agar satu baris utuh.

    Header tabel (GillSans-SemiBold 9.2) yang punya sel di kedua kolom menandai tabel
    lebar-penuh, kecuali kolom kanan memiliki judul tabelnya sendiri tepat di atas
    header (dua tabel terpisah yang kebetulan sejajar) atau baris body tabel lain
    yang berlanjut tepat di atas header.
    """
    headers: dict[int, set[int]] = {}
    for run in runs:
        if run["font"] == "GillSans-SemiBold" and run["size"] == 9.2:
            headers.setdefault(round(run["y"]), set()).add(run["col"])
    # Some headers mix bold 9.2pt and regular 9.5pt cells (Travel Terrain).
    for run in runs:
        y = round(run["y"])
        if y in headers and is_table_run(run) and run["size"] in (9.2, 9.5):
            headers[y].add(run["col"])
    # A wide final column can extend right even when all header labels fit left.
    # Require two aligned body rows; the separate-title guard below still applies.
    for y0, cols in headers.items():
        if cols != {0}:
            continue
        row_columns: dict[int, set[int]] = {}
        for run in runs:
            if is_table_run(run) and run["size"] == 9.5 and 1 < y0 - run["y"] <= 35:
                row_columns.setdefault(round(run["y"]), set()).add(run["col"])
        if sum(row_cols == {0, 1} for row_cols in row_columns.values()) >= 2:
            cols.add(1)
    for y0, cols in sorted(headers.items(), reverse=True):
        if cols != {0, 1}:
            continue
        own_title = any(
            r["col"] == 1 and r["font"] == "GillSans-SemiBold" and r["size"] == 10.5 and 0 < r["y"] - y0 <= 30
            for r in runs
        )
        # Right-column table rows just above the header mean a different table continues there.
        continues = any(r["col"] == 1 and is_table_run(r) and r["size"] == 9.5 and 1 < r["y"] - y0 <= 22 for r in runs)
        if own_title or continues:
            continue
        levels = sorted({round(r["y"]) for r in runs if is_table_run(r) and r["y"] <= y0 + 1}, reverse=True)
        table_ys = []
        last = None
        for y in levels:
            if last is not None and last - y > 22:
                break
            table_ys.append(y)
            last = y
        for run in runs:
            if run["col"] == 1 and is_table_run(run) and round(run["y"]) in table_ys:
                run["col"] = 0
        # Raised note markers belong to the adjacent cell/footnote baseline.
        for run in runs:
            if not is_table_run(run) or run["size"] > 6 or round(run["y"]) not in table_ys:
                continue
            adjacent = [
                r for r in runs
                if r["col"] == run["col"] and is_table_run(r) and r["size"] >= 8
                and 0 < run["y"] - r["y"] <= 4
                and min(abs(r["x1"] - run["x"]), abs(run["x1"] - r["x"])) <= 2
            ]
            if adjacent:
                anchor = min(adjacent, key=lambda r: abs(run["y"] - r["y"]))
                run["y"], run["size"] = anchor["y"], anchor["size"]


def main(pdf_path: str, out_path: str) -> None:
    import pymupdf

    data = open(pdf_path, "rb").read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED_SHA256:
        sys.exit(f"unexpected SRD file hash {digest}")
    doc = pymupdf.open(pdf_path)
    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        for index, page in enumerate(doc):
            width = page.rect.width
            height = page.rect.height
            runs = []
            for block in page.get_text("rawdict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        for piece in pieces(span):
                            text = piece["text"].strip()
                            if not text:
                                continue
                            y = height - piece["y"]
                            runs.append(
                                {
                                    "page": index + 1,
                                    "col": 0 if piece["x"] < width / 2 - 5 else 1,
                                    "x": round(piece["x"], 1),
                                    "x1": round(piece["x1"], 1),
                                    "y": round(y, 1),
                                    "font": font_name(span["font"]),
                                    "size": round(span["size"], 1),
                                    "text": text,
                                }
                            )
            # Header (judul dokumen) dan footer (nomor halaman).
            body = [r for r in runs if 30 <= r["y"] <= height - 45]
            merge_full_width_tables(body)
            body.sort(key=lambda r: (r["col"], -r["y"], r["x"]))
            for run in body:
                out.write(json.dumps(run, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
