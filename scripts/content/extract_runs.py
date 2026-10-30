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

import pymupdf

EXPECTED_SHA256 = "8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87"


def font_name(name: str) -> str:
    return name.split("+", 1)[-1]


def pieces(span: dict) -> list[dict]:
    """Pecah span pada celah antar-karakter yang jauh lebih lebar dari spasi biasa."""
    size = span["size"]
    out = []
    current = None
    last_x1 = None
    for char in span["chars"]:
        x0, _, x1, _ = char["bbox"]
        c = char["c"]
        gap = x0 - last_x1 if last_x1 is not None else 0
        if current is not None and gap > size * 0.9:
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


def main(pdf_path: str, out_path: str) -> None:
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
            body.sort(key=lambda r: (r["col"], -r["y"], r["x"]))
            for run in body:
                out.write(json.dumps(run, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
