#!/usr/bin/env python3
"""
Point the Tankcams at gannet's latest.jpg files and write data/webcam.json.

Each camera overwrites v1_web/<dir>/latest.jpg with each new frame. Its
Last-Modified header gives the capture time, which is also appended to the
URL (?t=<epoch>) so browsers see each frame as new. One camera being down
only blanks that camera; the file falls back to the published copy only when
every camera fails.

Usage:
    python scripts/update_webcam.py
"""

import os
import sys
import urllib.error
import urllib.request
from datetime import timezone
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(__file__))
from common import USER_AGENT, fallback, now_iso, write_json  # noqa: E402

GANNET = "https://gannet.fish.washington.edu/v1_web"
CAMS = [
    {"id": "cam1", "name": "Tankcam 1", "src": os.environ.get("WEBCAM_URL", f"{GANNET}/webcam/latest.jpg")},
    {"id": "cam2", "name": "Tankcam 2", "src": os.environ.get("WEBCAM2_URL", f"{GANNET}/webcam_02/latest.jpg")},
]


def head(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.headers


def frame(src):
    headers = head(src)
    stamp = headers.get("Last-Modified")
    captured = parsedate_to_datetime(stamp).astimezone(timezone.utc).replace(microsecond=0) if stamp else None
    return {
        "url": f"{src}?t={int(captured.timestamp())}" if captured else src,
        "captured_at": captured.isoformat() if captured else None,
        "bytes": int(headers.get("Content-Length") or 0) or None,
    }


def main():
    cams, errors = [], []
    for cam in CAMS:
        entry = {"id": cam["id"], "name": cam["name"], "source": cam["src"], "latest": None}
        try:
            entry["latest"] = frame(cam["src"])
            print(f"{cam['id']}: {entry['latest']['url']} ({entry['latest']['captured_at']})")
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            entry["error"] = f"latest.jpg fetch failed: {exc}"
            errors.append(f"{cam['id']}: {exc}")
            print(f"{cam['id']}: {entry['error']}", file=sys.stderr)
        cams.append(entry)

    if all(c["latest"] is None for c in cams):
        fallback("webcam.json", "; ".join(errors))
        return 0

    write_json("webcam.json", {
        "updated_at": now_iso(),
        # source/latest mirror the first camera, for older page versions.
        "source": cams[0]["source"],
        "latest": cams[0]["latest"],
        "cams": cams,
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
