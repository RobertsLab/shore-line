# SHORE dashboard

Live portal for the **Shellfish Hardening & Organismal Resilience Experimentation Center** (Roberts Lab, UW).
Published at **https://robertslab.github.io/shore-line/**.

| Widget | Source | Refresh |
|---|---|---|
| Live Tankcam | gannet `v1_web/webcam/` directory listing → `data/webcam.json` | site rebuild every ~10 min; page re-polls every 60 s |
| Puget Sound water temp | NOAA CO-OPS (Tacoma 9446484, fallback Port Townsend) → `data/field-water.json` + `assets/water-banner.svg` | every rebuild |
| Water-quality reports + per-tank readings | genefish RSS (Jesse Lowe) → `data/reports.json` | every rebuild |
| Facility temperatures | `data/tanks.json` (setpoints, placeholders); **Left Blue is live** from a seneye → `seneye-data` branch → `data/seneye.json` | collector every 15 min |
| Research from SHORE | `data/research.json` (hand-curated) | — |

## How it works

A static site (`index.html`, `css/`, `js/`) with no build step.
[`.github/workflows/site.yml`](.github/workflows/site.yml) runs every 10 minutes. It fetches the live sources with the stdlib-only scripts in `scripts/`, writes the results into `_site/`, and deploys to GitHub Pages. Fetched data is **not committed**. If a source is down, the script republishes the copy that is currently live and marks it with an `error`, and the status dot for that feed turns amber or red.

## Tankcam AI captions

`scripts/caption_tankcam.py` runs in every build after the webcam step. It asks Claude (`claude-opus-5-5`, low effort, structured JSON output) to caption the latest frame. That happens at most once per 2-hour slot from 6 AM to 6 PM Pacific (7 a day, ~$2–3/month), and only when the frame has changed. The rest of the time it carries the published caption forward. The caption, an approximate oyster count (only when oysters are visible), and anomaly flags are added to `data/webcam.json` and shown under the snapshot, labelled "AI caption".

- **Needs:** the `ANTHROPIC_API_KEY` Actions secret. Without it, the step skips quietly. If the key isn't scoped to a workspace, also set the `ANTHROPIC_WORKSPACE_ID` repo variable.
- **Change the model:** set the `CAPTION_MODEL` env var on the workflow step.
- **Caption immediately, ignoring the schedule:** `python scripts/caption_tankcam.py --force`. This needs the key in your environment and `pip install anthropic`.

## Seneye (Left Blue tank)

The Seneye Web Server sits on a private UW address (`172.25.149.26`), which GitHub can't reach. So `scripts/collect_seneye.py` runs on a machine inside the network. It decodes the SWS WebSocket state, which has no JSON API, and keeps a 14-day series. `scripts/seneye_publish.sh` force-pushes that file as a single commit on the `seneye-data` branch. The site build mirrors it from the `SENEYE_URL` repo variable.

- **Currently runs on:** sr320's Mac, via launchd every 15 min. It only collects while that Mac is on and on the UW network. Log: `/tmp/shore-seneye.log`.
- **Install / update** (after editing either script):

```bash
scripts/install_seneye_agent.sh
```

- **Uninstall:** `launchctl unload ~/Library/LaunchAgents/com.robertslab.shore-seneye.plist`
- **Moving to gannet later:** run `seneye_publish.sh` from cron there. Alternatively, write the JSON to a web-served path and point `SENEYE_URL` at it.
- **Device limits:** the SWS allows one WebSocket client at a time, so the collector retries if someone has the device's page open. When the chemical slide is missing or expired, the device reports pH/NH₃ as 0. The collector publishes `null` for those instead.

## Common edits

- **Feature a paper:** add an object to `items` in `data/research.json` (`featured: true` puts it in the top cards, max 3). Remove the placeholder entry once there's a real one.
- **Tank list / setpoints:** edit `data/tanks.json`. Set `status` to anything other than `placeholder` and fill `latest` / `series` when a logger feed exists.
- **Change feeds:** env vars `WEBCAM_URL`, `REPORTS_FEED`, `SITE_LABEL`.

## Run locally

```bash
python3 scripts/update_webcam.py && python3 scripts/update_reports.py && python3 scripts/update_field_water.py
```

```bash
python3 -m http.server 8320
```

Then open http://localhost:8320. `update_field_water.py --demo` uses synthetic data when you have no network.

See [PLAN.md](PLAN.md) for the roadmap.
