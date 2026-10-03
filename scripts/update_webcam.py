#!/usr/bin/env python3
"""
Find the newest tank-room webcam frames on gannet and write data/webcam.json.

gannet serves a plain Apache index with no CORS headers, so the browser
cannot list it; this script does the listing and the page hotlinks the jpgs.

  cam-srlab-*.jpg  timed frames, one every 5 min (older ones are moved off)
  ss_push_*.jpg    motion / push snapshots, kept as "events"

Usage:
    python scripts/update_webcam.py
"""

import os
import re
import sys
import urllib.error
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(__file__))
from common import fallback, get, now_iso, write_json  # noqa: E402

BASE = os.environ.get("WEBCAM_URL", "https://gannet.fish.washington.edu/v1_web/webcam/")
N_FRAMES = 12
N_EVENTS = 12
# Partial or black frames come through at ~15 KB; real frames are ~450 KB.
MIN_FRAME_BYTES = 60 * 1024

ROW = re.compile(
    r'<a href="(?P<name>[^"]+\.jpe?g)">.*?</a></td>\s*'
    r'<td[^>]*>(?P<mod>\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*</td>\s*'
    r'<td[^>]*>\s*(?P<size>[\d.]+[KMG]?)\s*</td>',
    re.IGNORECASE,
)
CAM = re.compile(r"Cam-(\d+)", re.IGNORECASE)


def to_bytes(size):
    mult = {"K": 1024, "M": 1024 ** 2, "G": 1024 ** 3}
    if size[-1].upper() in mult:
        return int(float(size[:-1]) * mult[size[-1].upper()])
    return int(size)


def parse_listing(html):
    rows = []
    for m in ROW.finditer(html):
        rows.append({
            "name": m.group("name"),
            "modified": m.group("mod"),  # gannet local time, naive
            "bytes": to_bytes(m.group("size")),
        })
    return rows


def last_modified_utc(url):
    """Absolute capture time from the image's Last-Modified header."""
    import urllib.request
    from common import USER_AGENT

    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        stamp = resp.headers.get("Last-Modified")
    if not stamp:
        return None
    return parsedate_to_datetime(stamp).astimezone(timezone.utc).replace(microsecond=0).isoformat()


def entry(row):
    cam = CAM.search(row["name"])
    return {
        "url": BASE + row["name"],
        "camera": int(cam.group(1)) if cam else None,
        "local_time": row["modified"],
        "bytes": row["bytes"],
    }


def main():
    try:
        rows = parse_listing(get(BASE).decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        fallback("webcam.json", f"listing fetch failed: {exc}")
        return 0

    newest_first = lambda rs: sorted(rs, key=lambda r: (r["modified"], r["name"]), reverse=True)
    frames = newest_first(
        r for r in rows
        if r["name"].startswith("cam-") and r["bytes"] >= MIN_FRAME_BYTES
    )
    events = newest_first(r for r in rows if r["name"].startswith("ss_push_"))

    if not frames:
        fallback("webcam.json", "no usable cam-* frames in listing")
        return 0

    latest = entry(frames[0])
    try:
        latest["captured_at"] = last_modified_utc(latest["url"])
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"HEAD {latest['url']}: {exc}", file=sys.stderr)
        latest["captured_at"] = None

    write_json("webcam.json", {
        "updated_at": now_iso(),
        "source": BASE,
        "latest": latest,
        "frames": [entry(r) for r in frames[:N_FRAMES]],
        "events": [entry(r) for r in events[:N_EVENTS]],
    })
    print(f"latest frame {latest['url']} ({latest['captured_at']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
