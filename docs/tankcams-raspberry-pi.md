# Per-tank cameras: Raspberry Pi + USB webcam sketch (10 tanks)

**Status:** design sketch, nothing built. Prices are rough (Oct 2026) and should be checked before ordering.

## Goal

A top-down snapshot of each of 10 tanks every 5 minutes, shown on the dashboard as a grid of per-tank Tankcams. Optional AI captions and oyster counts, like the existing Tankcam.

## Layout

```
  Rack A (tanks 1–4)          Rack B (tanks 5–7)          Rack C (tanks 8–10)
  ┌──┐┌──┐┌──┐┌──┐            ┌──┐┌──┐┌──┐                ┌──┐┌──┐┌──┐
  │📷││📷││📷││📷│            │📷││📷││📷│                │📷││📷││📷│     USB webcam on an arm,
  └┬─┘└┬─┘└┬─┘└┬─┘            └┬─┘└┬─┘└┬─┘                └┬─┘└┬─┘└┬─┘     30–50 cm above water
   └───┴─┬─┴───┘               └───┼───┘                   └───┼───┘     USB (active extension if > 3 m)
     ┌───┴────┐                ┌───┴────┐                  ┌───┴────┐
     │ Pi  A  │                │ Pi  B  │                  │ Pi  C  │     capture every 5 min (systemd timer)
     └───┬────┘                └───┬────┘                  └───┬────┘
         └──────── Ethernet (lab switch / PoE) ────────────────┘
                                   │  rsync over SSH
                                   ▼
                gannet  /v1_web/tankcams/<tank>/latest.jpg + timestamped.jpg + manifest-<pi>.json
                                   │  site build (every ~10 min)
                                   ▼
                     scripts/update_tankcams.py → data/tankcams.json → dashboard grid
```

One Pi per rack keeps the USB cables short. Three Pis for 10 tanks means each Pi handles 3–4 cameras. Cameras are captured **one after another**, never at the same time, so a Pi's USB bandwidth is not a limit.

## Hardware (10 tanks)

| Item | Qty | ~Each | ~Total | Notes |
|---|---|---|---|---|
| 1080p USB webcam (UVC, **manual/fixed focus**) | 10 | $20–25 | $225 | Fixed distance, so autofocus only causes "hunting". Must work with Linux (UVC). |
| Raspberry Pi 4 (2 GB) or Pi 5 | 3 | $45–60 | $160 | 4 USB ports. Use a powered USB hub if a Pi gets >4 cameras. |
| Pi power supply (or PoE HAT, if the lab switch has PoE) | 3 | $10–20 | $45 | PoE means one cable per Pi. The Reolink already runs on PoE. |
| microSD card, 32 GB, endurance-rated | 3 | $10 | $30 | Endurance cards survive constant writes. |
| Active USB extension (only for runs > 3 m) | 0–10 | $12 | $0–120 | Plain USB 2.0 is unreliable beyond ~5 m. |
| Articulating arm / clamp mount + small splash hood | 10 | $8–12 | $100 | Mount above the tank, out of splash range. |
| **Total** | | | **~$560–680** | About $55–70 per tank, all included. |

## Mounting and image quality

These details matter more than the camera model.

- **Top-down, fixed position.** Use the same framing every time, so captions and counts are comparable day to day. Mark the arm position.
- **Clearance and splash.** Mount 30–50 cm above the water, with a small hood or clear acrylic shield. Salt spray and condensation are the main way these cameras fail. Expect to wipe lenses during routine tank checks.
- **Glare.** Overhead lights reflecting off the water hide the oysters. Angle the camera slightly off vertical, or add a cheap circular polarizer clip.
- **Locked exposure and white balance.** Set them per camera with `v4l2-ctl` at boot, so frames don't drift with room lighting.
- **Label everything.** Cables, USB ports and arms are tagged with the tank ID.

## Software on each Pi

- **OS:** Raspberry Pi OS Lite (64-bit), with `fswebcam` (or `ffmpeg`), `v4l-utils` and `rsync`.
- **Stable camera IDs:** use `/dev/v4l/by-path/...`, which is tied to the physical USB port, not `/dev/video0`, which can reorder at boot. A small config maps each port to a tank.

```yaml
# /etc/tankcam.yaml on Pi A
pi: rack-a
upload: shore@gannet.fish.washington.edu:/path/to/v1_web/tankcams/
cameras:
  - tank: tank-01
    device: /dev/v4l/by-path/platform-fd500000.pcie-pci-0000:01:00.0-usb-0:1.1:1.0-video-index0
  - tank: tank-02
    device: /dev/v4l/by-path/...-usb-0:1.2:1.0-video-index0
  # ...
```

- **Capture loop:** a systemd timer every 5 min. For each camera:

```bash
# skip the first frames so exposure settles; no overlay text
fswebcam -d "$DEV" -r 1920x1080 --skip 20 --no-banner --jpeg 85 "$OUT/$TANK/$(date +%Y%m%d-%H%M).jpg"
cp "$OUT/$TANK/$(date +%Y%m%d-%H%M).jpg" "$OUT/$TANK/latest.jpg"
```

  Then it writes `manifest-rack-a.json` (tank → latest file, capture time, OK/error per camera) and runs `rsync -a --delete-after` of the last 24 h to gannet over SSH.

- **Housekeeping:** delete local frames older than 2 days. The Pi sends a heartbeat in the manifest even if a camera fails, so the dashboard can tell "camera unplugged" from "Pi offline".
- **Access needed:** an SSH key from each Pi to a gannet account allowed to write to the web directory. This replaces the FTP upload the Reolink uses.

## Dashboard changes (in this repo)

- **`scripts/update_tankcams.py`:** reads the three manifests from gannet and writes `data/tankcams.json`. It reuses the fallback-to-published-copy pattern.
- **Tankcam grid:** the single Tankcam becomes a grid of 10 small tiles. Each shows the tank name, capture time and a stale badge, and enlarges on click. It can be linked to the matching card in Facility temperatures and the water-quality table.
- **Captions (optional):** extend `caption_tankcam.py` to caption each tank at the same 2-hour slots. Each caption and oyster count would sit with its tank's tile. Cost scales with cameras:

| Captions | 1 camera (now) | 10 cameras |
|---|---|---|
| Opus 5.5, 7×/day | ~$2–3/mo | ~$25/mo |
| Haiku 4.5, 7×/day | <$1/mo | ~$6/mo |

  Top-down views are what make an approximate oyster count possible. Treat counts as indicative, not as data.

## Open decisions

1. Exact tank list and rack layout: how many cameras per Pi, and the cable runs.
2. Is a PoE switch with free ports available near the racks? If so, use PoE HATs; otherwise wall power.
3. A gannet account and path for uploads, which needs whoever manages gannet.
4. Captions per tank: Opus or Haiku, and whether counts are wanted.
5. Who checks lenses and mounts during routine tank checks.
