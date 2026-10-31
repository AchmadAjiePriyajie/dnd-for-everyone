"""Rakit tabel SRD dari baris yang span-nya membawa posisi x.

extract_runs.py memecah run pada celah lebar, sehingga setiap sel tabel
menjadi span sendiri. Kolom ditentukan dari posisi x span header.
"""

from srdlines import Line, fix_text

CELL_END = (".", "!", "?", ")", "”")


def column_for(x: float, starts: list[float]) -> int:
    best = 0
    for index, start in enumerate(starts):
        if x + 4 >= start:
            best = index
    return best


def join_cell(left: str, right: str) -> str:
    if not left:
        return right
    if left.endswith(" -"):
        return left[:-2] + right
    if left.endswith("-") and right[:1].islower():
        return left[:-1] + right
    if left.endswith(("—", "–", "/")):
        return left + right
    return f"{left} {right}"


def cells_of(line: Line, starts: list[float]) -> list[str]:
    row = [""] * len(starts)
    for span in sorted(line.spans, key=lambda s: s[3]):
        index = column_for(span[3], starts)
        row[index] = join_cell(row[index], fix_text(span[2]))
    return row


def cells_by_gap(line: Line) -> list[tuple[float, str]]:
    """Gabungkan kata header yang berjarak spasi biasa menjadi satu sel."""
    cells: list[list] = []
    for span in sorted(line.spans, key=lambda s: s[3]):
        if cells and span[3] - cells[-1][2] < span[1] * 0.6:
            cells[-1][1] = join_cell(cells[-1][1], fix_text(span[2]))
            cells[-1][2] = span[4]
        else:
            cells.append([span[3], fix_text(span[2]), span[4]])
    return [(x, text) for x, text, _ in cells]


def header_columns(headers: list[Line]) -> tuple[list[float], list[str]]:
    """Kolom dari baris header dengan sel terbanyak; baris header lain ditempel ke kolom terdekat."""
    groups = [cells_by_gap(line) for line in headers]
    base = max(groups, key=len)
    starts = [x for x, _ in base]
    columns = [""] * len(starts)
    for group in groups:
        for x, text in group:
            index = min(range(len(starts)), key=lambda i: abs(starts[i] - x))
            columns[index] = join_cell(columns[index], text)
    return starts, columns


def column_intervals(headers: list[Line], rows: list[Line]) -> list[tuple[float, float]] | None:
    """Rentang x tiap kolom dari celah vertikal yang kosong di header dan semua baris.

    Baris dengan satu sel saja (judul grup yang melebar) tidak ikut agar tidak
    menutup celah antarkolom.
    """
    spans = [(s[3], s[4], s[1]) for line in headers for s in line.spans]
    for line in rows:
        if len(cells_by_gap(line)) >= 2:
            spans.extend((s[3], s[4], s[1]) for s in line.spans)
    if not spans:
        return None
    merged: list[list[float]] = []
    for x0, x1, size in sorted(spans):
        # Celah lebih kecil dari ~setengah em = spasi antarkata dalam satu sel.
        if merged and x0 <= merged[-1][1] + size * 0.45:
            merged[-1][1] = max(merged[-1][1], x1)
        else:
            merged.append([x0, x1])
    return [(a, b) for a, b in merged]


def assemble_table(lines: list[tuple[str, Line]]) -> dict | None:
    """lines: (kind, Line) dengan kind 'title'|'header'|'row'. None bila tanpa header."""
    title = None
    headers: list[Line] = []
    body: list[Line] = []
    for kind, line in lines:
        if kind == "title":
            title = fix_text(" ".join(s[2] for s in sorted(line.spans, key=lambda s: s[3])))
        elif kind == "header":
            if body:
                return None
            headers.append(line)
        else:
            if not headers:
                return None
            body.append(line)
    if not headers:
        return None

    starts, columns = header_columns(headers)
    intervals = column_intervals(headers, body)
    if intervals and len(intervals) == len(starts):
        def locate(x: float) -> int:
            for index, (_a, b) in enumerate(intervals):
                if x <= b + 1:
                    return index
            return len(intervals) - 1
    else:
        def locate(x: float) -> int:
            return column_for(x, starts)

    rows: list[list[str]] = []
    for line in body:
        row = [""] * len(starts)
        groups = cells_by_gap(line)
        if len(groups) == 1:
            # Satu sel utuh (judul grup yang melebar, atau baris lanjutan): satu kolom.
            row[locate(groups[0][0])] = groups[0][1]
        else:
            for span in sorted(line.spans, key=lambda s: s[3]):
                index = locate(span[3])
                row[index] = join_cell(row[index], fix_text(span[2]))
        only_first = row[0] and not any(row[1:])
        if rows and only_first and len(row) > 1 and row[0][:1].islower():
            # Lanjutan teks sel pertama yang terbungkus (mis. "Viewed once or" + "described").
            rows[-1][0] = join_cell(rows[-1][0], row[0])
            continue
        if rows and not row[0]:
            for index, cell in enumerate(row):
                if cell:
                    rows[-1][index] = join_cell(rows[-1][index], cell)
        else:
            rows.append(row)
    return {"title": title, "columns": columns, "rows": rows}


def to_markdown(table: dict) -> str:
    def esc(cell: str) -> str:
        return cell.replace("|", "\\|")

    out = []
    if table.get("title"):
        out.append(f"**{table['title']}**")
        out.append("")
    out.append("| " + " | ".join(esc(c) for c in table["columns"]) + " |")
    out.append("|" + "|".join("---" for _ in table["columns"]) + "|")
    for row in table["rows"]:
        out.append("| " + " | ".join(esc(c) for c in row) + " |")
    return "\n".join(out)
