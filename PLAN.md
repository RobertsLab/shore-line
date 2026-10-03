# SHORE portal: build plan

> **Status (2026-10-02):** phases 0–4 scaffolded. Decided: webcam option B (listing scraper), hosted at RobertsLab/shore-line on GitHub Pages. Changes from the original plan: research is `data/research.json` (stdlib, no YAML), and data is fetched at deploy time instead of committed (one `site.yml` workflow), so the history stays clean. Water-quality per-tank parsing (originally phase 2) is already in.

A public dashboard for the **Shellfish Hardening & Organismal Resilience Experimentation Center (SHORE)** in the Roberts Lab. It shows what is happening in the controlled-environment facility right now (webcams, tank temperatures, water-quality reports), the field conditions outside (Puget Sound water temperature), and the research the Center produces.

## 1. What the data sources look like (checked 2026-10-02)

| Source | What's there | Browser-fetchable? | Consequence |
|---|---|---|---|
| Webcam `gannet.fish.washington.edu/v1_web/webcam/` | Apache directory listing. A new `cam-srlab-YYYYMMDD-<id>-Cam-2-Type-0.jpg` arrives every 5 min (older ones get moved off, see `move_snapshots.log`). There are also motion/push snapshots `ss_push_*.jpg`. | The listing has **no CORS headers**, so page JS can't read it. Loading the `.jpg` files with `<img>` works fine. | We need a stable "latest" URL. See §3.1. |
| Water-quality RSS `genefish.wordpress.com/author/jlowe50bd14a0c15/feed/` | WordPress RSS 2.0 with posts by Jesse Lowe, e.g. "Tank room and survival assays" (latest 2026-10-01). Full post HTML is in `content:encoded`. | **No CORS headers.** | Turn the feed into JSON at build time (GitHub Action). |
| Field water temperature | Same approach as `sr320/sr320`: `scripts/update_banner.py` pulls 7 days of 6-min `water_temperature` from NOAA CO-OPS (Tacoma 9446484, then Port Townsend 9444900 as fallback) and renders `assets/water-banner.svg`. Runs daily at 15:00 UTC. | The NOAA API can be called directly. | Reuse the script and also write JSON so the page can draw an interactive chart. |
| Tank / room temperatures | Don't exist yet. | — | Placeholder cards that read from a JSON schema we define now, so real loggers can be connected later without touching the UI. |
| Research outputs | Curated list. | — | A YAML/JSON file the lab edits. |

## 2. Architecture

**A static site on GitHub Pages, with GitHub Actions writing the data files.** Same pattern as the profile README, so the lab already knows how to run it.

```
shore-line/
├── index.html              # single-page dashboard
├── css/shore.css           # design tokens, light/dark, responsive grid
├── js/
│   ├── main.js             # loads data/*.json, renders each widget
│   ├── widgets/webcam.js
│   ├── widgets/tanks.js
│   ├── widgets/reports.js  # water-quality RSS cards
│   ├── widgets/field.js    # Puget Sound temperature chart
│   └── widgets/research.js
├── data/                   # written by Actions (except research + tank config)
│   ├── webcam.json         # latest frame URL + timestamp + recent thumbnails
│   ├── reports.json        # parsed water-quality feed
│   ├── field-water.json    # 7-day NOAA series + latest reading
│   ├── tanks.json          # placeholder now, real logger data later
│   └── research.yml        # curated publications/preprints/datasets (hand-edited)
├── assets/
│   ├── water-banner.svg    # same banner as the profile, reused
│   └── shore-logo.svg
├── scripts/
│   ├── update_webcam.py
│   ├── update_reports.py
│   ├── update_field_water.py   # adapted from sr320/sr320 scripts/update_banner.py
│   └── build_research.py       # validates research.yml → research.json
└── .github/workflows/
    ├── data-refresh.yml    # cron: webcam + reports + field water
    └── pages.yml           # deploy to GitHub Pages
```

Why this setup:
- No server to look after, and it's free to host.
- The scripts use only the standard library, like `update_banner.py`.
- Every widget reads one JSON file. When a data source changes, only its script changes.
- Every JSON file carries `updated_at`, so each widget can show a "stale" badge if its feed stops updating.

## 3. Dashboard sections

### 3.1 Live webcam
- A hero tile showing the current frame, its timestamp ("5 min ago") and an auto-refresh every 60 s, plus a strip of the last ~12 frames (the hour so far) that you can click to enlarge.
- **How we get the latest frame (pick one):**
  - **A (recommended):** add one line on gannet to the existing snapshot-move job that keeps `webcam/latest.jpg` updated (symlink or copy). The page then loads `latest.jpg?t=<now>`. This is truly live, needs no Actions, and is the simplest option.
  - **B (fallback, no gannet changes):** `update_webcam.py` parses the directory listing for the newest `cam-srlab-*` file and writes `data/webcam.json`. GitHub cron runs every 5 min at best and is often late, so the image could be 5 to 20 min old.
- `ss_push_*` motion snapshots go in an "Events" gallery, kept apart from the timed frames.
- If there are more cameras later (the filename already says `Cam-2`), the widget takes an array of cameras.

### 3.2 Facility temperatures (placeholders)
- One card per system: e.g. Tank Room A/B, the hardening (heat-stress) system, broodstock, and the ambient room.
- Each card shows the current value, the setpoint, a band showing whether it's inside tolerance, and a 24 h sparkline.
- For now, `tanks.json` holds clearly marked **placeholder** values and the cards say "sensor not yet connected". The schema:

```json
{
  "updated_at": "2026-10-02T17:10:00-07:00",
  "systems": [
    {
      "id": "hardening-1",
      "name": "Hardening System 1",
      "setpoint_c": 25.0,
      "tolerance_c": 0.5,
      "status": "placeholder",
      "latest": { "t": "…", "temp_c": null },
      "series": []
    }
  ]
}
```

- Later: a logger (Apex, HOBO export, Raspberry Pi probe) pushes CSV to gannet, and an Action or cron converts it to this schema. The UI doesn't change.

### 3.3 Water-quality reports (RSS widget)
- `update_reports.py` fetches the feed hourly and writes the 10 newest items to `reports.json` with `title`, `link`, `date`, `author`, a ~200-character `summary` with HTML stripped, and the first image if there is one.
- Each item shows as a card that links to the full post on genefish.
- Optional phase 2: if the posts follow a regular format (pH, salinity, DO, ammonia…), pull those numbers into small "last reported" tiles. Check a few posts' `content:encoded` first before relying on this.
- The feed URL lives in config, so more authors or category feeds can be added as extra widgets.

### 3.4 Field conditions (live Puget Sound data)
- Port `update_banner.py` as `update_field_water.py`. It keeps the station fallback logic and writes both:
  - `assets/water-banner.svg`, the same banner as the profile, and
  - `field-water.json`, so the page can draw an interactive 7-day chart with hover.
- The headline line matches the profile: "**13.6 °C** in the water off Manchester, Puget Sound · Oct 2 12:36 · via NOAA CO-OPS Tacoma, WA".
- Run it every 3 h, not daily, since the dashboard should feel live. Optionally add a browser-side fetch from the NOAA API on page load for the newest reading, falling back to the JSON.
- Later: more stations or parameters (air temp, tide height), and a map pin for Manchester.

### 3.5 Research from the Center
- `data/research.yml` is hand-curated. Each entry has: `title`, `authors`, `year`, `venue`, `type` (paper / preprint / dataset / report / notebook), `doi` or `url`, `tags` (e.g. *Crassostrea gigas*, heat hardening, OA), `featured: true|false`, and an optional `image`.
- The layout puts 1–3 featured items as large cards, then a list you can filter by type and tag.
- Phase 2: pull DOI metadata from Crossref, and auto-import SHORE-tagged reports from Current Findings (`robertslab.github.io/current-findings`).

### 3.6 Page frame
- A header with the SHORE name and logo and a one-line mission.
- A status strip at the top with one dot per feed (webcam, temps, reports, field). Each is green, amber or red depending on `updated_at`.
- A footer with UW / Roberts Lab links, contact, and data credits (NOAA CO-OPS, genefish).
- Responsive: a 12-column grid on desktop, one column on phones. Light and dark themes. Every image has alt text.

## 4. Workflows

`data-refresh.yml`:
```yaml
on:
  schedule:
    - cron: "*/10 * * * *"   # webcam (only if option B)
    - cron: "7 * * * *"      # reports, hourly
    - cron: "15 */3 * * *"   # field water
  workflow_dispatch:
```
- Each job runs its script, then commits only if `data/` changed, using the same "no change → exit" step as `water-banner.yml`.
- A shared `concurrency` group prevents conflicting pushes.
- `pages.yml` deploys on every push to `main`.

Note: commits every 10 min will fill the git history. If we go with webcam option A, the 10-min job goes away. Otherwise, write data to a `gh-pages`/`data` branch with force-push so `main` stays clean.

## 5. Phased delivery

| Phase | Scope | Done when |
|---|---|---|
| **0 – Scaffold** | Repo layout, `index.html` shell, CSS tokens, Pages deploy, README | The site is live at `<org>.github.io/shore-line` with empty widgets |
| **1 – Field + reports** | Port the NOAA script; RSS → JSON; both widgets; status strip | Real Puget Sound temp and the latest Jesse Lowe posts show and refresh themselves |
| **2 – Webcam** | Option A (`latest.jpg` on gannet) or B (listing scraper), hero tile + strip + events gallery | The current tank-room frame shows and is ≤5 min old (A) or ≤20 min old (B) |
| **3 – Facility temps** | `tanks.json` schema and placeholder cards with sparklines | Cards show and are clearly labelled as placeholders |
| **4 – Research** | `research.yml` seeded with SHORE outputs, featured cards and filters | The lab can add a paper by editing one YAML file |
| **5 – Polish / later** | Real sensor ingest, parsed water-quality metrics, alerts (e.g. Slack when a tank leaves tolerance), more cameras, custom domain | — |

## 6. Decisions needed from the lab

1. **Webcam:** can we add a `latest.jpg` symlink on gannet (option A)? Or should we scrape the listing (option B)?
2. **Hosting:** GitHub Pages under `sr320`, `RobertsLab`, or a UW domain?
3. **Tank list:** which systems, setpoints and tolerances should the placeholder cards show?
4. **Research seed list:** which papers, preprints and datasets count as SHORE outputs to start with?
5. **Public vs. internal:** is it OK for the webcam and tank data to be public? If not, put the portal behind UW NetID or keep the webcam to an internal page.
