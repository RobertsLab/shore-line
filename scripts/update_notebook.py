#!/usr/bin/env python3
"""
Most recent posts from the whole Roberts Lab notebook
(genefish.wordpress.com, all authors) -> data/notebook.json.

Reuses the feed parsing from update_reports.py.

Usage:
    python scripts/update_notebook.py
"""

import os
import sys
import urllib.error
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
from common import fallback, get, now_iso, write_json  # noqa: E402
from update_reports import parse  # noqa: E402

FEED = os.environ.get("NOTEBOOK_FEED", "https://genefish.wordpress.com/feed/")
N_POSTS = 9


def main():
    try:
        title, posts = parse(get(FEED))
    except (urllib.error.URLError, TimeoutError, ET.ParseError, ValueError) as exc:
        fallback("notebook.json", f"feed fetch failed: {exc}")
        return 0

    keep = ("title", "link", "author", "published", "summary", "image")
    write_json("notebook.json", {
        "updated_at": now_iso(),
        "source": FEED,
        "feed_title": title,
        "posts": [{k: p[k] for k in keep} for p in posts[:N_POSTS]],
    })
    print(f"{len(posts)} posts, newest {posts[0]['published'] if posts else 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
