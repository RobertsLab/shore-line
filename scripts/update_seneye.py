#!/usr/bin/env python3
"""
Mirror the seneye JSON written by collect_seneye.py (on a machine inside the
UW network) into the site build as data/seneye.json.

SENEYE_URL is where the collector's output is web-served (set as a GitHub
Actions repository variable). Unset means no seneye yet: nothing is written
and the Left Blue card stays a placeholder.

Usage:
    SENEYE_URL=https://.../seneye.json python scripts/update_seneye.py
"""

import json
import os
import sys
import urllib.error

sys.path.insert(0, os.path.dirname(__file__))
from common import fallback, get, write_json  # noqa: E402

URL = os.environ.get("SENEYE_URL", "").strip()


def main():
    if not URL:
        print("SENEYE_URL not set, skipping seneye", file=sys.stderr)
        return 0
    try:
        doc = json.loads(get(URL))
        if "latest" not in doc:
            raise ValueError("no latest reading in seneye JSON")
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        fallback("seneye.json", f"seneye fetch failed: {exc}")
        return 0
    write_json("seneye.json", doc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
