#!/usr/bin/env python3
"""
Build data/shore-temps.json from the ESP32 temperature hubs' raw CSVs on
Gannet (one file per hub per UTC day, written by the SHORE_temps receiver):

    <SHORE_TEMPS_URL>/<hub>/<YYYY-MM-DD>.csv
    received_utc,reading_utc,hub,uptime_s,probe_id,temp_c

Hubs are discovered from the directory listing, so a new hub shows up on its
own. For each probe we keep the latest reading and a 24 h series averaged
into 10-minute bins. Temperatures are raw (uncalibrated); probe names come
from data/tanks.json in the browser, not from here.

Usage:
    python scripts/update_shore_temps.py
"""

import csv
import io
import os
import re
import sys
import urllib.error
from collections import defaultdict
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from common import fallback, get, now_iso, write_json  # noqa: E402

BASE = os.environ.get(
    "SHORE_TEMPS_URL",
    "https://gannet.fish.washington.edu/v1_web/SHORE_temps/data/raw/",
).rstrip("/") + "/"
WINDOW = timedelta(hours=24)
BIN_MIN = 10


def parse_t(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def list_hubs():
    html = get(BASE).decode("utf-8", "replace")
    return sorted(set(re.findall(r'href="([A-Za-z0-9_.-]+)/"', html)))


def fetch_rows(hub, day):
    try:
        text = get(f"{BASE}{hub}/{day:%Y-%m-%d}.csv").decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:  # no readings that day (yet)
            return []
        raise
    return list(csv.DictReader(io.StringIO(text)))


def main():
    now = datetime.now(timezone.utc)
    since = now - WINDOW
    try:
        hubs = list_hubs()
        if not hubs:
            raise ValueError("no hub folders in listing")
        readings = defaultdict(list)  # (hub, probe) -> [(t, temp)]
        for hub in hubs:
            for day in sorted({since.date(), now.date()}):
                for r in fetch_rows(hub, day):
                    if not r.get("temp_c"):
                        continue  # probe failed to read
                    # The hub's own timestamp when it has NTP, else arrival.
                    t = parse_t(r.get("reading_utc") or r["received_utc"])
                    if t >= since:
                        readings[(hub, r["probe_id"])].append((t, float(r["temp_c"])))
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        fallback("shore-temps.json", f"shore-temps fetch failed: {exc}")
        return 0

    probes = []
    for (hub, pid), pts in sorted(readings.items()):
        pts.sort()
        bins = defaultdict(list)
        for t, v in pts:
            start = t.replace(second=0, microsecond=0, minute=t.minute - t.minute % BIN_MIN)
            bins[start].append(v)
        probes.append({
            "hub": hub,
            "id": pid,
            "latest": {"t": iso(pts[-1][0]), "temp_c": pts[-1][1]},
            "min_c": min(v for _, v in pts),
            "max_c": max(v for _, v in pts),
            "series": [[iso(b), round(sum(vs) / len(vs), 3)] for b, vs in sorted(bins.items())],
        })

    write_json("shore-temps.json", {
        "updated_at": now_iso(),
        "source": BASE,
        "hubs": hubs,
        "probes": probes,
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
