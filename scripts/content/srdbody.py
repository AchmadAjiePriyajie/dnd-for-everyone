"""Ubah baris SRD menjadi markdown: paragraf, run-in heading, daftar, subjudul, tabel."""

import re

from srdlines import Line, fix_text
from srdtables import assemble_table, to_markdown

TERMINATORS = (".", ":", "!", "?", "”", ")", "’", "—")
SHORT_LINE = 42


def style_of(font: str) -> str:
    bold = "Bold" in font or "SemiBold" in font
    italic = "Italic" in font
    return "bi" if bold and italic else "b" if bold else "i" if italic else ""


MARK = {"bi": "***", "b": "**", "i": "*", "": ""}


def is_table_line(line: Line) -> bool:
    if not line.font.startswith("GillSans") or "SC" in line.font:
        return False
    return line.size in (9.2, 9.5, 10.5)


def is_sidebar_title(line: Line) -> bool:
    return line.font == "GillSans-Bold-SC700" and line.size == 11.0


def is_sidebar_text(line: Line) -> bool:
    """Kotak sidebar: GillSans 9pt atau ScalaSans (mis. "Exceptions Supersede General Rules")."""
    return line.font.startswith("ScalaSans") or (line.font.startswith("GillSans") and line.size == 9.0 and "SemiBold" not in line.font)


def is_display_line(line: Line) -> bool:
    """Baris rumus/daftar GillSans 10pt (mis. "Base AC 10 + ..."): satu baris satu paragraf."""
    return line.font.startswith("GillSans") and line.size == 10.0 and "Light" not in line.font


def table_kind(line: Line) -> str:
    if line.size == 10.5:
        return "title"
    if line.size == 9.2:
        return "header"
    return "row"


def is_subheading(line: Line) -> bool:
    if line.font == "GillSans" and line.size == 12.0:
        # Judul bagian stat block: Traits, Actions, Bonus Actions, Reactions, Legendary Actions.
        return True
    return line.font.startswith("GillSans-SemiBold") and line.size in (12.0, 14.0, 18.0) and "SC" not in line.font


class Words:
    """Kata dari corpus untuk memutuskan apakah tanda hubung di akhir baris itu pemenggalan."""

    def __init__(self, lines: list[Line]):
        self.words: set[str] = set()
        broken = False
        for line in lines:
            tokens = re.findall(r"[A-Za-z]+", line.text)
            ends_broken = line.text.endswith("-")
            # Potongan kata di sekitar pemenggalan bukan kata utuh.
            if broken and tokens:
                tokens = tokens[1:]
            if ends_broken and tokens:
                tokens = tokens[:-1]
            self.words.update(t.lower() for t in tokens)
            broken = ends_broken

    def joins(self, left: str, right: str) -> bool:
        a = re.search(r"([A-Za-z]+)$", left)
        b = re.match(r"([A-Za-z]+)", right)
        if not (a and b):
            return False
        left_word, right_word = a.group(1).lower(), b.group(1).lower()
        if (left_word + right_word) in self.words:
            return True
        # Pertahankan tanda hubung hanya bila kedua sisi kata utuh (mis. "long-dead").
        return not (left_word in self.words and right_word in self.words)


def join_text(left: str, right: str, words: Words) -> str:
    if not left:
        return right
    if left.endswith(" -") and right[:1].isalpha():
        return left[:-2] + right
    if left.endswith("-") and not left.endswith("--") and right[:1].islower() and words.joins(left[:-1], right):
        return left[:-1] + right
    if left.endswith(("-", "—", "–", "/")):
        return left + right
    return left + " " + right


class Paragraph:
    def __init__(self) -> None:
        self.pieces: list[list[str]] = []  # [style, text]

    def add_line(self, line: Line, words: Words, first: bool) -> None:
        for index, span in enumerate(line.spans):
            font, text = span[0], span[2]
            style = style_of(font)
            text = fix_text(text)
            if not self.pieces:
                self.pieces.append([style, text])
                continue
            last = self.pieces[-1]
            if style == last[0]:
                last[1] = join_text(last[1], text, words) if index == 0 else last[1] + " " + text
            else:
                # Pemenggalan di batas gaya: tempelkan tanda hubung ke potongan sebelumnya.
                if index == 0 and last[1].endswith(" -"):
                    last[1] = last[1][:-2]
                    self.pieces.append([style, text])
                    self.pieces[-1].append("nospace")
                else:
                    self.pieces.append([style, text])

    def render(self) -> str:
        out = ""
        for piece in self.pieces:
            style, text = piece[0], piece[1]
            nospace = len(piece) > 2
            core = text.strip()
            if not core:
                continue
            mark = MARK[style]
            rendered = f"{mark}{core}{mark}" if mark else core
            if out and not nospace and not out.endswith(("(", "“", "—", "–", "/")) and not core.startswith((",", ".", ";", ":", ")", "”", "’")):
                out += " "
            out += rendered
        return re.sub(r"\s+", " ", out).strip()


def key_value_block(lines: list[Line], words: Words) -> str:
    """Tabel dua kolom tanpa header (mis. Core Barbarian Traits): label kiri, nilai kanan."""
    # Kolom nilai = posisi baris lanjutan (GillSans reguler); label selalu di kiri.
    continuation = [line.x for line in lines if line.font == "GillSans"]
    left = min(line.x for line in lines)
    value_x = (min(continuation) if continuation else left + 95) - 4
    fields: list[list[str]] = []
    for line in lines:
        label = " ".join(s[2] for s in sorted(line.spans, key=lambda s: s[3]) if s[3] < value_x)
        value = " ".join(s[2] for s in sorted(line.spans, key=lambda s: s[3]) if s[3] >= value_x)
        if label and value:
            fields.append([label, value])
        elif label and fields:
            # Label dua baris ("Saving Throw" + "Proficiencies").
            fields[-1][0] = f"{fields[-1][0]} {label}"
        elif label:
            fields.append([label, ""])
        elif fields:
            fields[-1][1] = join_text(fields[-1][1], value, words)
    return "\n".join(f"**{label}:** {value}" for label, value in fields)


def table_segments(group: list[Line]) -> list[list[Line]]:
    """Pecah grup baris tabel menjadi tabel terpisah; tabel berdampingan dibelah per x."""
    if group and table_kind(group[0]) == "title" and re.match(r"^Core .+ Traits$", group[0].text):
        cut = next((i for i in range(1, len(group)) if table_kind(group[i]) == "title"), len(group))
        return [group[:cut]] + (table_segments(group[cut:]) if cut < len(group) else [])
    segments: list[list[Line]] = []
    current: list[Line] = []
    for line in group:
        kind = table_kind(line)
        if kind in ("title", "header") and current and any(table_kind(l) == "row" for l in current):
            segments.append(current)
            current = []
        current.append(line)
    if current:
        segments.append(current)

    out: list[list[Line]] = []
    for segment in segments:
        split = side_by_side_split(segment)
        if split is None:
            out.append(segment)
            continue
        left, right = [], []
        for line in segment:
            for side, keep in ((left, lambda s: s[3] < split - 5), (right, lambda s: s[3] >= split - 5)):
                spans = [s for s in line.spans if keep(s)]
                if spans:
                    side.append(Line(line.page, line.col, line.y, spans[0][3], spans))
        out.extend([left, right])
    return out


def side_by_side_split(segment: list[Line]) -> float | None:
    """x awal tabel kanan bila dua tabel dicetak berdampingan (dua judul, atau header berulang)."""
    title = next((l for l in segment if table_kind(l) == "title"), None)
    if title and len(title.spans) > 1:
        spans = sorted(title.spans, key=lambda s: s[3])
        gaps = [(b[3] - a[4], b[3]) for a, b in zip(spans, spans[1:])]
        if gaps and max(gaps)[0] > 40:
            return max(gaps)[1]
    header = next((l for l in segment if table_kind(l) == "header"), None)
    if header and len(header.spans) >= 4 and len(header.spans) % 2 == 0:
        half = len(header.spans) // 2
        names = [s[2] for s in header.spans]
        if names[:half] == names[half:]:
            return header.spans[half][3]
    return None


def build_body(lines: list[Line], words: Words, in_sidebar: bool = False) -> str:
    blocks: list[str] = []
    base: dict[tuple[int, int], float] = {}
    for line in lines:
        key = (line.page, line.col)
        base[key] = min(base.get(key, line.x), line.x)

    para: Paragraph | None = None
    prev: Line | None = None
    hanging = False
    pending_hanging = False

    def flush() -> None:
        nonlocal para, hanging, pending_hanging
        if para and para.pieces:
            text = para.render()
            if text:
                blocks.append(text)
        para = None
        hanging = False
        pending_hanging = False

    i = 0
    while i < len(lines):
        line = lines[i]
        if not in_sidebar and (is_sidebar_title(line) or is_sidebar_text(line)):
            flush()
            title = None
            inner: list[Line] = []
            if is_sidebar_title(line):
                title = line.text
                i += 1
            while i < len(lines) and is_sidebar_text(lines[i]):
                inner.append(lines[i])
                i += 1
            text = build_body(inner, words, in_sidebar=True)
            quoted = ([f"**{title}**", ""] if title else []) + text.split("\n")
            blocks.append("\n".join(f"> {q}".rstrip() for q in quoted))
            prev = None
            continue
        if is_table_line(line):
            flush()
            group = []
            while i < len(lines) and is_table_line(lines[i]):
                group.append(lines[i])
                i += 1
            for segment in table_segments(group):
                if segment and table_kind(segment[0]) == "title" and re.match(r"^Core .+ Traits$", segment[0].text):
                    blocks.append(f"**{segment[0].text}**\n\n" + key_value_block(segment[1:], words))
                    continue
                items = [(table_kind(seg_line), seg_line) for seg_line in segment]
                table = assemble_table(items)
                if table:
                    blocks.append(to_markdown(table))
                else:
                    blocks.extend(seg_line.text for seg_line in segment)
            prev = None
            continue
        if is_subheading(line):
            flush()
            level = "###" if line.size >= 14 else "####"
            text = line.text
            while i + 1 < len(lines) and is_subheading(lines[i + 1]) and lines[i + 1].size == line.size and lines[i].y - lines[i + 1].y <= line.size * 1.35 and lines[i + 1].page == line.page:
                i += 1
                text += " " + lines[i].text
            blocks.append(f"{level} {text}")
            prev = None
            i += 1
            continue

        indent = line.x - base[(line.page, line.col)]
        starts_bold = style_of(line.spans[0][0]) in ("b", "bi")
        bullet = line.text.startswith("•")
        new = para is None
        if not new:
            if pending_hanging and indent > 4:
                hanging = True
                pending_hanging = False
            elif hanging:
                prev_end = prev is None or prev.text.endswith(TERMINATORS)
                starts_runin = style_of(line.spans[0][0]) == "bi"
                new = (prev_end and (indent <= 4 or starts_runin)) or (is_display_line(line) and indent <= 4)
                if not new and indent <= 4:
                    hanging = False
            else:
                prev_short = prev is not None and len(prev.text) < SHORT_LINE and prev.text.endswith(TERMINATORS)
                prev_end = prev is None or prev.text.endswith(TERMINATORS)
                new = indent > 4 or bullet or prev_short or (starts_bold and prev_end)
                if is_display_line(line) and indent <= 4:
                    new = True
                if prev is not None and is_display_line(prev) and not is_display_line(line) and indent <= 4:
                    # Teks biasa setelah baris rumus/field selalu paragraf baru.
                    new = True
                pending_hanging = False
        if new:
            flush()
            para = Paragraph()
            pending_hanging = indent <= 4 and (starts_bold or bullet)
        para.add_line(line, words, new)
        prev = line
        i += 1
    flush()
    return "\n\n".join(blocks)
