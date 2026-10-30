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
    for _font, _size, text, x in line.spans:
        index = column_for(x, starts)
        row[index] = join_cell(row[index], fix_text(text))
    return row


def header_columns(headers: list[Line]) -> tuple[list[float], list[str]]:
    """Kolom dari baris header dengan span terbanyak; baris header lain ditempel ke kolom terdekat."""
    base = max(headers, key=lambda line: len(line.spans))
    starts = [s[3] for s in base.spans]
    columns = [""] * len(starts)
    for line in headers:
        for _font, _size, text, x in line.spans:
            index = min(range(len(starts)), key=lambda i: abs(starts[i] - x))
            columns[index] = join_cell(columns[index], fix_text(text))
    return starts, columns


def assemble_table(lines: list[tuple[str, Line]]) -> dict | None:
    """lines: (kind, Line) dengan kind 'title'|'header'|'row'. None bila tanpa header."""
    title = None
    headers: list[Line] = []
    starts: list[float] = []
    columns: list[str] = []
    rows: list[list[str]] = []
    for kind, line in lines:
        if kind == "title":
            title = fix_text(" ".join(s[2] for s in line.spans))
            continue
        if kind == "header":
            if rows:
                return None
            headers.append(line)
            continue
        if not headers:
            return None
        if not starts:
            starts, columns = header_columns(headers)
        row = cells_of(line, starts)
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
    if not headers:
        return None
    if not starts:
        starts, columns = header_columns(headers)
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
