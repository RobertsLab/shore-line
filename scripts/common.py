"""
Shared helpers for the SHORE data scripts. Standard library only.

The site is rebuilt from scratch on every run and data is never committed,
so when a source is down each script falls back to the copy currently
published on GitHub Pages instead of publishing a gap.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

SITE_URL = os.environ.get("SITE_URL", "https://robertslab.github.io/shore-line/")
OUT_DIR = os.environ.get("OUT_DIR", "data")
USER_AGENT = "shore-portal/1.0 (+https://github.com/RobertsLab/shore-line)"


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def out_path(name):
    os.makedirs(OUT_DIR, exist_ok=True)
    return os.path.join(OUT_DIR, name)


def write_json(name, payload):
    path = out_path(name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"{path}: written")


def fallback(name, reason):
    """Keep the last published copy of data/<name>; mark it stale."""
    print(f"{name}: {reason}", file=sys.stderr)
    try:
        payload = json.loads(get(SITE_URL.rstrip("/") + "/data/" + name))
        payload["error"] = str(reason)
        write_json(name, payload)
        print(f"{name}: kept previously published copy", file=sys.stderr)
    except Exception as exc:  # first deploy, or the site itself is down
        print(f"{name}: no published copy either ({exc})", file=sys.stderr)
        write_json(name, {"updated_at": None, "error": str(reason)})
