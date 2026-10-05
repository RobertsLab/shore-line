#!/usr/bin/env python3
"""
Point the Tankcam at gannet's latest.jpg and write data/webcam.json.

The camera overwrites v1_web/webcam/latest.jpg with each new frame. Its
Last-Modified header gives the capture time, which is also appended to the
URL (?t=<epoch>) so browsers and caption_tankcam.py see each frame as new.

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

LATEST = os.environ.get("WEBCAM_URL", "https://gannet.fish.washington.edu/v1_web/webcam/latest.jpg")


def head(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.headers


def main():
    try:
        headers = head(LATEST)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        fallback("webcam.json", f"latest.jpg fetch failed: {exc}")
        return 0

    stamp = headers.get("Last-Modified")
    captured = parsedate_to_datetime(stamp).astimezone(timezone.utc).replace(microsecond=0) if stamp else None
    latest = {
        "url": f"{LATEST}?t={int(captured.timestamp())}" if captured else LATEST,
        "captured_at": captured.isoformat() if captured else None,
        "bytes": int(headers.get("Content-Length") or 0) or None,
    }

    write_json("webcam.json", {
        "updated_at": now_iso(),
        "source": LATEST,
        "latest": latest,
    })
    print(f"latest frame {latest['url']} ({latest['captured_at']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
