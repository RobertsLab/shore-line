# SHORE dashboard

Live portal for the **Shellfish Hardening & Organismal Resilience Experimentation Center** (Roberts Lab, UW).
Published at **https://robertslab.github.io/shore-line/**.

| Widget | Source | Refresh |
|---|---|---|
| Tank-room webcam | gannet `v1_web/webcam/` directory listing → `data/webcam.json` | site rebuild every ~10 min; page re-polls every 60 s |
| Puget Sound water temp | NOAA CO-OPS (Tacoma 9446484, fallback Port Townsend) → `data/field-water.json` + `assets/water-banner.svg` | every rebuild |
| Water-quality reports + per-tank readings | genefish RSS (Jesse Lowe) → `data/reports.json` | every rebuild |
| Facility temperatures | `data/tanks.json` (**placeholder**, hand-edited until loggers exist) | — |
| Research from SHORE | `data/research.json` (hand-curated) | — |

## How it works

A static site (`index.html`, `css/`, `js/`) with no build step.
[`.github/workflows/site.yml`](.github/workflows/site.yml) runs every 10 minutes. It fetches the live sources with the stdlib-only scripts in `scripts/`, writes the results into `_site/`, and deploys to GitHub Pages. Fetched data is **not committed**. If a source is down, the script republishes the copy that is currently live and marks it with an `error`, and the status dot for that feed turns amber or red.

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
