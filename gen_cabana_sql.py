# -*- coding: utf-8 -*-
"""
Generates the SQL INSERT statements that seed the `cabanas` table, from the
confirmed reading of VBR_Day_Trip_Layout.pdf (re-rendered at 400dpi and
verified pixel-by-pixel — the seemingly-duplicated numbers in Section A's
bottom two rows turned out to be two independent per-type sequences,
Dining Cabana and Lounge Cabana, not a transcription error).

Not shipped to the live site — this is a one-time generator whose output
gets pasted into SETUP-BOOKING.md / run once in the Supabase SQL editor.
"""

# Each row: (section, row_index, col_index, cabana_type, number)
UNITS = []

def add_row(section, row_index, cabana_type, numbers, start_col=0):
    for i, n in enumerate(numbers):
        UNITS.append((section, row_index, start_col + i, cabana_type, n))

# ---- Section B (left) ----
add_row("B", 0, "dining_cabana", [17, 18, 19, 20, 21, 22, 23, 24, 25])
add_row("B", 1, "dining_cabana", [7, 8, 9, 10, 11, 12, 14, 15, 16])
# row 2: col0 lounge#1, col1-3 dining 2/3/4, col4 pool (facility, no row),
# col5 pool bar (facility, no row), col6 dining#6
UNITS.append(("B", 2, 0, "lounge_cabana", 1))
UNITS.append(("B", 2, 1, "dining_cabana", 2))
UNITS.append(("B", 2, 2, "dining_cabana", 3))
UNITS.append(("B", 2, 3, "dining_cabana", 4))
UNITS.append(("B", 2, 6, "dining_cabana", 6))

# ---- Section A (right) ----
add_row("A", 0, "dining_cabana", [17, 18, 19, 20, 21])
add_row("A", 1, "dining_cabana", [22, 10, 11, 12, 14, 15, 16])
UNITS.append(("A", 2, 0, "dining_cabana", 4))
UNITS.append(("A", 2, 1, "dining_cabana", 5))
UNITS.append(("A", 2, 2, "dining_cabana", 6))
UNITS.append(("A", 2, 3, "dining_cabana", 7))
UNITS.append(("A", 2, 4, "dining_cabana", 8))
UNITS.append(("A", 2, 5, "lounge_cabana", 5))
UNITS.append(("A", 2, 6, "dining_cabana", 9))
UNITS.append(("A", 3, 0, "lounge_cabana", 1))
UNITS.append(("A", 3, 1, "dining_cabana", 1))
UNITS.append(("A", 3, 2, "lounge_cabana", 2))
UNITS.append(("A", 3, 3, "dining_cabana", 2))
UNITS.append(("A", 3, 4, "lounge_cabana", 3))
UNITS.append(("A", 3, 5, "dining_cabana", 3))
UNITS.append(("A", 3, 6, "lounge_cabana", 4))

TYPE_LABEL = {"dining_cabana": "Dining Cabana", "lounge_cabana": "Lounge Cabana"}

def label(section, cabana_type, number):
    return f"Section {section} — {TYPE_LABEL[cabana_type]} {number}"

def main():
    assert len(UNITS) == 49, len(UNITS)
    lines = []
    lines.append("insert into cabanas (section, row_index, col_index, cabana_type, number, label) values")
    values = []
    for section, row_index, col_index, cabana_type, number in UNITS:
        lbl = label(section, cabana_type, number).replace("'", "''")
        values.append(
            f"  ('{section}', {row_index}, {col_index}, '{cabana_type}', {number}, '{lbl}')"
        )
    lines.append(",\n".join(values) + ";")
    print("\n".join(lines))
    print(f"\n-- total units: {len(UNITS)}")
    dining = sum(1 for u in UNITS if u[3] == "dining_cabana")
    lounge = sum(1 for u in UNITS if u[3] == "lounge_cabana")
    print(f"-- dining_cabana: {dining}, lounge_cabana: {lounge}")

if __name__ == "__main__":
    main()
