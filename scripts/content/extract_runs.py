"""Ekstrak run teks SRD 5.2.1 beserta halaman, posisi, font dan ukuran.

Pemakaian (tooling dev, butuh `pypdf`):
    python -I scripts/content/extract_runs.py <srd.pdf> <out.jsonl>

Output satu run per baris: {"page", "col", "x", "y", "font", "size", "text"}.
Urutan baca: per halaman, kolom kiri lalu kanan, atas ke bawah. Header/footer
halaman dibuang. PDF sumber tidak ikut ke repo/build (folder referensi diabaikan Git).
"""

import hashlib
import json
import sys

from pypdf import PdfReader

EXPECTED_SHA256 = "8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87"

# Perbaikan karakter dari font Cambria pada ekstraksi (kutip pintar / ligatur).
REPLACEMENTS = {
    "�": "’",
}


def clean(text: str) -> str:
    for bad, good in REPLACEMENTS.items():
        text = text.replace(bad, good)
    return text


def main(pdf_path: str, out_path: str) -> None:
    data = open(pdf_path, "rb").read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED_SHA256:
        sys.exit(f"unexpected SRD file hash {digest}")
    reader = PdfReader(pdf_path)
    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        for index, page in enumerate(reader.pages):
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            runs = []

            def visit(text, cm, tm, font, size):
                if not text.strip():
                    return
                # Posisi absolut = tm × cm (hanya translasi & skala yang dipakai SRD).
                x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
                y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
                scale = (tm[0] * cm[0]) or 1
                name = (font or {}).get("/BaseFont", "?")
                name = name.split("+", 1)[-1]
                runs.append({"x": round(x, 1), "y": round(y, 1), "font": name, "size": round(size * abs(scale), 1), "text": clean(text.strip())})

            page.extract_text(visitor_text=visit)
            for run in runs:
                # Header (judul dokumen) dan footer (nomor halaman).
                if run["y"] > height - 45 or run["y"] < 30:
                    continue
                run["col"] = 0 if run["x"] < width / 2 - 5 else 1
                run["page"] = index + 1
            body = [r for r in runs if "page" in r]
            # Stabil: kolom, lalu y turun (y PDF dari bawah), lalu x.
            body.sort(key=lambda r: (r["col"], -r["y"], r["x"]))
            for run in body:
                out.write(json.dumps({k: run[k] for k in ("page", "col", "x", "y", "font", "size", "text")}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
