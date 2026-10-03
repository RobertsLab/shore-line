#!/usr/bin/env python3
"""
Turn the tank-room water-quality posts (genefish.wordpress.com, Jesse Lowe)
into data/reports.json for the dashboard.

Besides the post cards, it pulls per-tank readings out of sentences like
  "The Left Blue tank was at 30ppt salinity, 8 pH, 40 Alk, 0 ammonia,
   0 nitrite, and 40 nitrate"
so the page can show the most recent value for each tank and parameter.

Usage:
    python scripts/update_reports.py
"""

import html
import os
import re
import sys
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(__file__))
from common import fallback, get, now_iso, write_json  # noqa: E402

FEED = os.environ.get(
    "REPORTS_FEED", "https://genefish.wordpress.com/author/jlowe50bd14a0c15/feed/"
)
N_POSTS = 12
ACTIVE_DAYS = 45
NS = {
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
}

# WordPress.com appends a JSON blob of post metadata to content:encoded.
WP_JUNK = re.compile(r'\[\{"type":"post".*', re.DOTALL)
TANK_LINE = re.compile(r"\bthe\s+(?P<tank>[\w\- ]{2,30}?)\s+tank\s+was\s+at\s+(?P<body>[^\n]+)", re.I)
PARAMS = {
    "salinity_ppt": re.compile(r"([\d.]+)\s*ppt", re.I),
    "ph": re.compile(r"([\d.]+)\s*ph\b", re.I),
    "alkalinity": re.compile(r"([\d.]+)\s*alk", re.I),
    "ammonia": re.compile(r"([\d.]+)\s*ammonia", re.I),
    "nitrite": re.compile(r"([\d.]+)\s*nitrite", re.I),
    "nitrate": re.compile(r"([\d.]+)\s*nitrate", re.I),
}


def to_text(markup):
    markup = WP_JUNK.sub("", markup or "")
    markup = re.sub(r"<\s*(br|/p|/li|/h\d)[^>]*>", "\n", markup, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", markup))
    lines = [re.sub(r"[ \t ]+", " ", ln).strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def summary(text, limit=220):
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    return flat[:limit].rsplit(" ", 1)[0] + "…"


def readings(text):
    out = []
    for m in TANK_LINE.finditer(text):
        values = {}
        for key, rx in PARAMS.items():
            hit = rx.search(m.group("body"))
            if hit:
                try:
                    values[key] = float(hit.group(1).rstrip("."))
                except ValueError:
                    pass
        if values:
            out.append({"tank": m.group("tank").strip().title(), "values": values})
    return out


def parse(xml_bytes):
    channel = ET.fromstring(xml_bytes).find("channel")
    posts = []
    for item in channel.findall("item"):
        raw = item.findtext("content:encoded", default="", namespaces=NS)
        text = to_text(raw)
        img = re.search(r'<img[^>]+src="([^"]+)"', raw or "")
        posts.append({
            "title": html.unescape(item.findtext("title", "")).strip(),
            "link": item.findtext("link", "").strip(),
            "author": (item.findtext("dc:creator", "", NS) or "").strip(),
            "published": parsedate_to_datetime(item.findtext("pubDate")).isoformat(),
            "summary": summary(text),
            "image": img.group(1) if img else None,
            "readings": readings(text),
        })
    posts.sort(key=lambda p: p["published"], reverse=True)
    return channel.findtext("title", ""), posts


def latest_by_tank(posts, active_days=ACTIVE_DAYS):
    """Each tank's most recent reading, as one snapshot (values not mixed
    across posts). Tanks not reported within active_days of the newest
    reading are dropped, which retires old names like "Left"/"Right"."""
    tanks = {}
    for post in posts:  # newest first
        for r in post["readings"]:
            if r["tank"] not in tanks:
                tanks[r["tank"]] = {
                    "tank": r["tank"],
                    "reported": post["published"],
                    "link": post["link"],
                    "values": r["values"],
                }
    if not tanks:
        return []
    newest = max(datetime.fromisoformat(t["reported"]) for t in tanks.values())
    cutoff = newest - timedelta(days=active_days)
    keep = [t for t in tanks.values() if datetime.fromisoformat(t["reported"]) >= cutoff]
    return sorted(keep, key=lambda t: t["tank"])


def main():
    try:
        title, posts = parse(get(FEED))
    except (urllib.error.URLError, TimeoutError, ET.ParseError, ValueError) as exc:
        fallback("reports.json", f"feed fetch failed: {exc}")
        return 0

    write_json("reports.json", {
        "updated_at": now_iso(),
        "source": FEED,
        "feed_title": title,
        "tanks": latest_by_tank(posts),
        "posts": posts[:N_POSTS],
    })
    print(f"{len(posts)} posts, newest {posts[0]['published'] if posts else 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
