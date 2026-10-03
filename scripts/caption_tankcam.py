#!/usr/bin/env python3
"""
Caption the latest Tankcam frame with Claude, every two hours from 6 AM to
6 PM Pacific, and attach the result to data/webcam.json.

Runs after update_webcam.py on every site rebuild, but only calls the API
when a new slot (06, 08, ... 18 h) has started since the published caption
and the frame has changed. Otherwise the published caption is carried
forward, so late cron runs catch up and a stale camera costs nothing.

Needs ANTHROPIC_API_KEY (GitHub Actions secret), plus ANTHROPIC_WORKSPACE_ID
(repo variable) if the key is not scoped to a workspace. Without it, or on any API
error, the previous caption is kept and the build continues.

Usage:
    python scripts/caption_tankcam.py
    python scripts/caption_tankcam.py --force   # caption now, ignore the slot
"""

import json
import os
import sys
import urllib.error
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(__file__))
from common import SITE_URL, get, now_iso, out_path, write_json  # noqa: E402

MODEL = os.environ.get("CAPTION_MODEL", "claude-opus-5-5")
TZ = ZoneInfo("America/Los_Angeles")
SLOT_HOURS = (6, 8, 10, 12, 14, 16, 18)

SYSTEM = """You caption snapshots from the "Live Tankcam" in the Roberts Lab \
tank room (University of Washington), where shellfish (mostly oysters) are held \
in seawater tanks and small chambers on shelving racks for experiments. The \
caption appears under the snapshot on a public dashboard.

Describe what is actually visible, plainly, in one or two short sentences: \
equipment state, water in chambers, lights, people. Do not speculate beyond \
the image. People: say only that someone is present, never describe or \
identify them.

Oysters: set oysters_visible only if individual oysters can actually be seen. \
If so, give your best approximate count in oyster_count; otherwise 0.

anomalies: short phrases for things a lab manager would want to know, only \
when clearly visible (e.g. "water on floor", "chamber appears drained", \
"hose disconnected", "lights off"). Empty list if nothing stands out."""

SCHEMA = {
    "type": "object",
    "properties": {
        "caption": {"type": "string"},
        "oysters_visible": {"type": "boolean"},
        "oyster_count": {"type": "integer"},
        "people_present": {"type": "boolean"},
        "anomalies": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["caption", "oysters_visible", "oyster_count", "people_present", "anomalies"],
    "additionalProperties": False,
}


def current_slot(now):
    """Most recent slot start at or before now, e.g. 2026-10-02T14 (Pacific)."""
    local = now.astimezone(TZ)
    for day_back in (0, 1):
        day = local - timedelta(days=day_back)
        hours = [h for h in SLOT_HOURS if day_back or h <= local.hour]
        if hours:
            return day.replace(hour=hours[-1], minute=0, second=0, microsecond=0)
    raise AssertionError("unreachable")


def published_caption():
    try:
        return json.loads(get(SITE_URL.rstrip("/") + "/data/webcam.json")).get("caption")
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def ask_claude(image_url):
    import anthropic  # installed in the workflow; only needed when captioning

    # A key that isn't scoped to a workspace must name one per request.
    workspace = os.environ.get("ANTHROPIC_WORKSPACE_ID", "").strip()
    client = anthropic.Anthropic(
        default_headers={"anthropic-workspace-id": workspace} if workspace else None,
    )
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=SYSTEM,
        # Opus 5.5 always thinks; low effort is plenty for a short caption.
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        # On a safety decline, the API retries on a fallback model in-call.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "url", "url": image_url}},
                {"type": "text", "text": "Caption this Tankcam snapshot."},
            ],
        }],
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"no caption: stop_reason={response.stop_reason}")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text), response.model


def main():
    path = out_path("webcam.json")
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    latest = doc.get("latest") or {}
    previous = published_caption() or doc.get("caption")

    now = datetime.now(timezone.utc)
    slot = current_slot(now).isoformat()
    force = "--force" in sys.argv

    def keep(reason):
        if previous:
            doc["caption"] = previous
        write_json("webcam.json", doc)
        print(f"caption: {reason}", file=sys.stderr)
        return 0

    if not latest.get("url"):
        return keep("no frame")
    if not force and previous and previous.get("slot") == slot:
        return keep(f"slot {slot} already captioned")
    if not force and previous and previous.get("frame_url") == latest["url"]:
        previous["slot"] = slot  # same frame as last time: nothing new to say
        return keep("frame unchanged since last caption")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return keep("ANTHROPIC_API_KEY not set")

    try:
        result, served_by = ask_claude(latest["url"])
    except Exception as exc:  # any API/network/parse failure: keep the old caption
        return keep(f"captioning failed: {type(exc).__name__}: {exc}")

    doc["caption"] = {
        "slot": slot,
        "frame_url": latest["url"],
        "frame_captured_at": latest.get("captured_at"),
        "generated_at": now_iso(),
        "model": served_by,
        **result,
    }
    write_json("webcam.json", doc)
    print(f"caption ({served_by}): {result['caption']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
