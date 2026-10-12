#!/usr/bin/env python3
"""
Tank-room logbook (Google Sheet, filled in by hand about once a week)
-> data/logbook.json.

The sheet is published as CSV through its export URL, so no API key is
needed. Entries are kept as the strings typed into the sheet ("20-40",
"*7.8", "Y (10 mL)"); the widget shows them as logged rather than plotting.

Usage:
    python scripts/update_logbook.py
"""

import csv
import io
import os
import re
import sys
import urllib.error
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from common import fallback, get, now_iso, write_json  # noqa: E402

SHEET_ID = os.environ.get("LOGBOOK_SHEET_ID", "1S4Vl6K1NDTF3M6jTGDE0k0quQgOlQvjmN5Kka9JTBhg")
SHEET_GID = os.environ.get("LOGBOOK_SHEET_GID", "0")
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}"
EDIT_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit#gid={SHEET_GID}"

N_DAYS = 8       # most recent log dates listed in full
N_WEEKS = 12     # weekly activity strip

# Sheet header -> JSON key. Matched on the start of the header, case-insensitively,
# so small edits to the header text ("Feeding? (~20mL)") don't break the parse.
COLUMNS = [
    ("date", "date"),
    ("tank", "tank"),
    ("time", "time"),
    ("probe ph", "probe_ph"),
    ("temperature", "temp_c"),
    ("salinity", "salinity"),
    ("api ph", "api_ph"),
    ("ammonia", "ammonia"),
    ("nitrite", "nitrite"),
    ("nitrate", "nitrate"),
    ("initials", "initials"),
    ("water change", "water_change_gal"),
    ("feeding", "feeding"),
    ("tube change", "tube_change"),
]
EMPTY = {"", "n/a", "na", "-", "–"}


def clean(v):
    v = (v or "").strip()
    return None if v.lower() in EMPTY else v


def parse_date(s):
    """'1/13/25', '10/05/26', '4/30.26' -> date, or None."""
    m = re.fullmatch(r"(\d{1,2})\D(\d{1,2})\D(\d{2}|\d{4})", (s or "").strip())
    if not m:
        return None
    mo, d, y = (int(x) for x in m.groups())
    try:
        return date(y + 2000 if y < 100 else y, mo, d)
    except ValueError:
        return None


def column_map(header):
    cols = {}
    for i, h in enumerate(header):
        h = h.strip().lower()
        key = next((k for prefix, k in COLUMNS if h.startswith(prefix)), None)
        if key and key not in cols:
            cols[key] = i
        elif not h:
            cols.setdefault("notes", i)  # the unlabeled last column holds notes
    return cols


def parse(text):
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise ValueError("empty sheet")
    cols = column_map(rows[0])
    if "date" not in cols or "tank" not in cols:
        raise ValueError(f"unexpected header: {rows[0]}")

    entries, last_date, last_time = [], None, None
    for row in rows[1:]:
        cell = lambda k: clean(row[cols[k]]) if k in cols and cols[k] < len(row) else None  # noqa: E731
        if not any(c.strip() for c in row):
            continue
        d = parse_date(cell("date"))
        # A garbled date, or one that jumps far back in time (a "17" typed for
        # "26"), belongs to the row above: rows are entered in date order.
        if d is None or (last_date and d < last_date - timedelta(days=60)):
            d = last_date
        if d is None:
            continue
        # Time is usually filled in only on the first tank of a session.
        t = cell("time") or (last_time if d == last_date else None)
        last_date, last_time = d, t
        entry = {"date": d.isoformat(), "time": t}
        for _, key in COLUMNS[1:]:
            if key != "time":
                entry[key] = cell(key)
        entry["notes"] = cell("notes")
        if entry["tank"] or any(entry[k] for k in entry if k not in ("date", "time")):
            entries.append(entry)
    entries.sort(key=lambda e: e["date"])  # stable: keeps sheet order within a day
    return entries


def summarize(entries, today):
    by_day = {}
    for e in entries:
        by_day.setdefault(e["date"], []).append(e)
    days = [
        {
            "date": d,
            "initials": sorted({e["initials"] for e in rows if e["initials"]}),
            "entries": [{k: v for k, v in e.items() if k != "date" and v is not None} for e in rows],
        }
        for d, rows in sorted(by_day.items(), reverse=True)[:N_DAYS]
    ]

    # Monday-start weeks, oldest first, ending with the current week.
    this_week = today - timedelta(days=today.weekday())
    weeks = []
    for i in range(N_WEEKS - 1, -1, -1):
        start = this_week - timedelta(weeks=i)
        end = start + timedelta(days=7)
        logged = sorted({e["date"] for e in entries if start.isoformat() <= e["date"] < end.isoformat()})
        weeks.append({"week_of": start.isoformat(), "days_logged": len(logged), "dates": logged})
    return days, weeks


def main():
    try:
        entries = parse(get(CSV_URL).decode("utf-8-sig"))
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError, ValueError) as exc:
        fallback("logbook.json", f"sheet fetch failed: {exc}")
        return 0
    if not entries:
        fallback("logbook.json", "sheet has no dated entries")
        return 0

    days, weeks = summarize(entries, date.today())
    write_json("logbook.json", {
        "updated_at": now_iso(),
        "source": EDIT_URL,
        "first_entry": entries[0]["date"],
        "last_entry": entries[-1]["date"],
        "total_entries": len(entries),
        "days": days,
        "weeks": weeks,
    })
    print(f"{len(entries)} entries, {entries[0]['date']} to {entries[-1]['date']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
