# SHORE portal: plan and status

> **Status (2026-10-02):** live at **https://robertslab.github.io/shore-line/** (repo `RobertsLab/shore-line`). The original build plan (phases 0–4) is done and well extended. This file now records what's built, how it runs, and what's next. The original plan is in git history (`ac94249`).

A public dashboard for the **Shellfish Hardening & Organismal Resilience Experimentation Center (SHORE)** in the Roberts Lab. It shows what is happening in the tank room right now, field conditions in Puget Sound, lab notebook activity, and the research the Center produces.

## 1. What's on the page (top to bottom)

| Panel | Source | Updates | Notes |
|---|---|---|---|
| **Live Tankcam** | Reolink RLC-820A → FTP to gannet `v1_web/webcam/`; `update_webcam.py` finds the newest frame in the gannet folder listing | Every site rebuild (~10–20 min); page re-checks every 60 s | Single latest snapshot with a stale badge. **AI caption** below it (see §3). |
| **Latest tank water quality** | Values parsed from Jesse Lowe's tank-room posts (genefish RSS) | Every rebuild | Salinity, pH, alkalinity, NH₃, NO₂⁻, NO₃⁻ for each of the 4 tanks; "!" flags values outside thresholds |
| **Facility temperatures** | `data/tanks.json` (hand-edited) + seneye feed | Seneye every 15 min | **Left Blue is live** (seneye). The other blue/yellow tanks show an 11 °C default setpoint. The heat-exposure system and room air are placeholders. |
| **Field · Puget Sound water** | NOAA CO-OPS (Tacoma 9446484, fallback Port Townsend); adapted from `sr320/sr320` | Every rebuild | Headline reading + interactive 7-day chart; also writes the profile-style banner SVG |
| **Water-quality & tank-room reports** | Jesse Lowe's genefish RSS | Every rebuild | 3 latest posts |
| **Tank water quality · history** | The same parsed readings, ~3 months | Every rebuild | Chart by parameter, 1 or 3 months, fixed colors per tank |
| **Lab notebook · latest posts** | Site-wide genefish RSS (all authors) | Every rebuild | 6 latest posts |
| **Research from SHORE** | `data/research.json` (hand-edited) | On edit | Featured cards + filterable list. **Still has a placeholder entry.** |
| Header / footer | — | — | SHORE*line* wordmark, a status dot per feed (Tankcam, tank temps, water quality, Puget Sound), and an Instagram @robertslab.safs link in the footer |

Tried and removed: the X (@genefish) panel (X's embedded timeline no longer works, and reading posts through X's API is paid) and the Instagram embed panel (replaced by the footer link). Also removed: the Tankcam's earlier-frames strip and motion-snapshot gallery.

## 2. How it runs

- **Static site** (`index.html`, `css/`, `js/widgets/*.js`), no build step.
- **One workflow, `.github/workflows/site.yml`:** runs every 10 min (GitHub often runs it late), on every push to `main`, and on manual trigger. It runs the stdlib-only scripts in `scripts/`, writes the data into the build, and deploys to GitHub Pages.
  - **No data commits:** fetched data is **never committed**. If a source is down, each script republishes the copy that is currently live, marked with an `error`.
  - **Cache busting:** CSS/JS links get the commit hash appended on each deploy, so browsers load changes right away.
- **Data files:** each panel reads its own JSON file under `data/`. Every file has an `updated_at`, which drives the stale badges and status dots.

| Script | Output |
|---|---|
| `update_webcam.py` | `webcam.json` (latest frame) |
| `caption_tankcam.py` | Adds `caption` to `webcam.json` (Claude, see §3) |
| `update_reports.py` | `reports.json` (posts, per-tank latest readings, ~3-month history) |
| `update_notebook.py` | `notebook.json` |
| `update_field_water.py` | `field-water.json` + `assets/water-banner.svg` |
| `update_seneye.py` | `seneye.json`, copied from the seneye data branch (§4) |

**Repo settings:**

| Setting | Name | Value |
|---|---|---|
| Actions secret | `ANTHROPIC_API_KEY` | Claude API key for Tankcam captions |
| Actions variable | `ANTHROPIC_WORKSPACE_ID` | `wrkspc_01QYGJ8tVrxdvdnkULR6jbZQ` (the key isn't scoped to a workspace) |
| Actions variable | `SENEYE_URL` | Raw URL of `seneye.json` on the `seneye-data` branch |
| Pages | Source | GitHub Actions |

## 3. Tankcam AI captions

`caption_tankcam.py` asks **Claude Opus 5.5** (low effort, structured JSON output, automatic retry on another model if a request is declined) to caption the latest frame.
- **Schedule:** at most once per 2-hour slot from **6 AM to 6 PM Pacific** (7 a day), and only when the frame has changed.
- **Cost:** about **$2–3/month**.
- **Output:** the caption, people present, an approximate oyster count (only when oysters are visible), and anomaly flags. These show under the snapshot, labelled as AI-generated.
- **Flags:** the lab chose to keep the current, fairly sensitive flags as they are.
- **Failure:** any API failure keeps the previous caption.

## 4. Seneye (Left Blue tank)

The Seneye Web Server is on a private UW address (`172.25.149.26`), which GitHub can't reach.
- **Collector:** `collect_seneye.py` decodes the device's WebSocket state (it has no JSON API). It runs **every 15 min via launchd on sr320's Mac**, which must be on and on the UW network.
- **Publishing:** it force-pushes the readings file as a single commit on the `seneye-data` branch.
- **Install/update:** `scripts/install_seneye_agent.sh`. Log: `/tmp/shore-seneye.log`.
- **Known state:** the pH/NH₃ slides are **expired**, so only temperature is shown until new slides are fitted.

## 5. Next steps / roadmap

| Item | Status | Doc / next action |
|---|---|---|
| **Tankcam stalled** | The camera stopped uploading to gannet at 5:10 PM on Oct 2 | Check the camera's FTP upload, power and network in the tank room |
| **Research list** | Placeholder entry still showing | Add real SHORE papers, preprints and datasets to `data/research.json` |
| **Tank setpoints / tolerances** | Blue/yellow tanks default to 11 °C, no tolerance | Set real values in `data/tanks.json`. Heat-exposure system and room air need setpoints. |
| **Seneye hosting** | Runs on sr320's Mac | Move to gannet or a lab Pi (README has notes); fit new pH/NH₃ slides |
| **Per-tank cameras** | Design done | [docs/tankcams-raspberry-pi.md](docs/tankcams-raspberry-pi.md): 3 Pis + 10 USB webcams, ~$560–680. Needs a tank list/layout, PoE availability, and a gannet upload account. |
| **Valve-gape monitors** | Design done | [docs/gape-monitors-usb-pi.md](docs/gape-monitors-usb-pi.md): Adalogger + TLV493D over USB to a rack Pi; mortality/stress flags. Next: a one-logger pilot on sr320's Mac. |
| **Cheaper replacement camera** | Researched | Reolink RLC-510A (~$55, PoE, same FTP setup) instead of RLC-820A (~$261); test timed FTP upload on one first |
| **Wyze cameras** | Researched, not pursued | Would need docker-wyze-bridge; snapshot approach recommended if revisited |
| Later | — | Alerts (e.g. Slack when a tank leaves tolerance or a gape monitor flags possible mortality), Crossref metadata for research items, custom domain |

## 6. Decisions made

- **Hosting:** GitHub Pages under `RobertsLab`, public.
- **Tankcam:** gannet folder-listing scraper (no `latest.jpg` symlink on gannet). Single latest snapshot, renamed "Live Tankcam".
- **Layout order:** Tankcam + latest water quality → facility temperatures → Puget Sound + reports → water-quality history → lab notebook → research.
- **Captions:** Opus 5.5, every 2 h from 6 AM to 6 PM, current flag sensitivity kept.
- **Social:** no embeds; Instagram link in the footer only.

## 7. Open questions for the lab

1. Are the lab members and spaces in the Tankcam frame (and future cameras) OK to show publicly?
2. Tank list and rack layout for per-tank cameras and gape monitors.
3. Who manages gannet uploads for new devices: an account and folder for the Pis.
4. Long-term archive location for raw sensor data (gape CSVs, seneye history).
