"""Kelompokkan run hasil extract_runs.py menjadi baris berurutan baca.

Satu baris = run pada halaman/kolom/y yang sama. Setiap baris membawa span
(font, size, text) agar parser bisa membedakan heading, label tebal dan isi.
"""

import json
import re
from dataclasses import dataclass, field

CHAPTERS = [
    (5, "playing-the-game"),
    (19, "character-creation"),
    (28, "classes"),
    (83, "character-origins"),
    (87, "feats"),
    (89, "equipment"),
    (104, "spells"),
    (176, "rules-glossary"),
    (192, "gameplay-toolbox"),
    (204, "magic-items"),
    (254, "monsters-intro"),
    (258, "monsters"),
    (344, "animals"),
]


def chapter_of(page: int) -> str:
    current = "front-matter"
    for start, name in CHAPTERS:
        if page >= start:
            current = name
    return current


@dataclass
class Line:
    page: int
    col: int
    y: float
    x: float
    spans: list = field(default_factory=list)  # (font, size, text, x, x1)
    x1: float = 0.0

    @property
    def text(self) -> str:
        return join_spans([s[2] for s in self.spans])

    @property
    def font(self) -> str:
        return self.spans[0][0]

    @property
    def size(self) -> float:
        return self.spans[0][1]

    @property
    def chapter(self) -> str:
        return chapter_of(self.page)

    def is_font(self, font: str, size: float | None = None) -> bool:
        return all(s[0] == font and (size is None or s[1] == size) for s in self.spans)


def join_spans(parts: list[str]) -> str:
    text = ""
    for part in parts:
        if not text:
            text = part
        elif text.endswith("-") and not text.endswith(" -"):
            text += part
        else:
            text += " " + part
    return fix_text(text)


def fix_text(text: str) -> str:
    for broken, fixed in LIGATURE_FIXES.items():
        text = text.replace(broken, fixed)
    return re.sub(r"\s+", " ", text).strip()


# Ligatur "fl" kadang terpecah spasi pada ekstraksi; diisi dari survei teks SRD.
LIGATURE_FIXES: dict[str, str] = {}


def load_lines(path: str) -> list[Line]:
    lines: list[Line] = []
    for raw in open(path, encoding="utf-8"):
        run = json.loads(raw)
        last = lines[-1] if lines else None
        if last and last.page == run["page"] and last.col == run["col"] and abs(last.y - run["y"]) < 1.5:
            prev = last.spans[-1]
            if -0.5 <= run["x"] - last.x1 < 0.8 and prev[0] == run["font"]:
                # Bersinggungan (mis. small caps beda ukuran): satu kata, tanpa spasi.
                last.spans[-1] = (prev[0], max(prev[1], run["size"]), prev[2] + run["text"], prev[3], run["x1"])
            else:
                last.spans.append((run["font"], run["size"], run["text"], run["x"], run["x1"]))
            last.x1 = run["x1"]
        else:
            lines.append(Line(run["page"], run["col"], run["y"], run["x"], [(run["font"], run["size"], run["text"], run["x"], run["x1"])]))
            lines[-1].x1 = run["x1"]
    return lines


def slug(text: str) -> str:
    text = text.lower().replace("’", "").replace("'", "")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")
