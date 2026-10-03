# Valve-gape monitors on the dashboard: USB-to-Pi setup (option A)

**Status:** design sketch, nothing built. The board code and collector below are untested drafts for a pilot.

## What we have

Each gape monitor is an **Adafruit RP2040 Feather Adalogger** running CircuitPython, with an **Adafruit TLV493D 3-axis magnetometer** on the STEMMA QT connector. A magnet glued to one valve and the sensor on the other means the field strength changes as the oyster opens and closes. The Adalogger has no network, so a computer must collect its readings over USB.

## Layout

```
  oyster + magnet
        │  (short STEMMA QT / I²C cable — keep < ~0.5–1 m)
  ┌─────┴──────┐
  │ TLV493D    │
  │ Adalogger  │  prints one CSV line per reading over USB;
  └─────┬──────┘  also logs to its microSD card as a backup
        │  USB (long is fine: ≤ 5 m plain, longer with active extension / powered hub)
  ┌─────┴──────┐
  │ Rack Pi    │  collect_gape.py (systemd service): timestamps lines, writes daily CSVs,
  │            │  every 5 min writes a summary JSON and rsyncs it to gannet
  └─────┬──────┘  (the same Pi as the rack's tankcams, if those are built)
        │  Ethernet → gannet /v1_web/gape/
        ▼
  site build → scripts/update_gape.py → data/gape.json → "Valve gape" panel
```

**Cable rule:** keep the sensor cable short and make the USB cable long. I²C fails over long wires; USB doesn't. If a sensor must be far from its logger, see the I²C options at the end.

## 1. Board code (`code.py` on each Adalogger)

The board prints a tidy, machine-readable line for each reading. It keeps no wall-clock time, because the Adalogger has no real-time clock; the Pi stamps each line on arrival. The board's own millisecond counter is included, so gaps and resets are detectable.

```python
# code.py — gape monitor (CircuitPython 10.x, RP2040 Feather Adalogger + TLV493D)
import time, board, supervisor, adafruit_tlv493d

supervisor.runtime.autoreload = False          # don't restart if the CIRCUITPY drive is touched
LOGGER_ID = open("/logger_id.txt").read().strip()   # e.g. "gape-07", one file per board
PERIOD_S = 1.0                                  # 1 reading per second

sensor = adafruit_tlv493d.TLV493D(board.STEMMA_I2C())

# Optional SD backup (Adalogger microSD); see Adafruit's Adalogger SD guide for mounting.
sd_log = None
try:
    import sdcardio, storage
    sd = sdcardio.SDCard(board.SPI(), board.SD_CS)
    storage.mount(storage.VfsFat(sd), "/sd")
    sd_log = open("/sd/gape.csv", "a")
except Exception as exc:
    print("SDFAIL," + LOGGER_ID + "," + str(exc))

n = 0
while True:
    t_ms = supervisor.ticks_ms()
    try:
        x, y, z = sensor.magnetic                # microtesla
        line = "GAPE,{},{},{:.1f},{:.1f},{:.1f}".format(LOGGER_ID, t_ms, x, y, z)
    except Exception as exc:
        line = "GAPEERR,{},{},{}".format(LOGGER_ID, t_ms, exc)
    print(line)
    if sd_log:
        sd_log.write(line + "\n")
        n += 1
        if n % 60 == 0:
            sd_log.flush()
    time.sleep(PERIOD_S)
```

Notes:
- **IDs:** each board's `logger_id.txt` holds its ID. A sticker on the board matches it.
- **Board names:** check `board.SD_CS` / SPI pin names against Adafruit's Adalogger pinout. Pin names vary between boards.
- **Interference:** printing to USB has no effect on the I²C sensor.

## 2. Collector on the Pi (`collect_gape.py`, runs as a service)

- **Finds the boards:** it watches `/dev/serial/by-id/usb-Adafruit_*` and opens each board it finds. Those names include the board's unique serial number, so they survive reboots and re-plugging. It handles boards being unplugged and plugged back in, and needs only the standard library (`termios` puts the port into raw mode).
- **Timestamps:** each `GAPE,...` line is stamped with UTC time on arrival and appended to `gape/<logger>/<YYYY-MM-DD>.csv` (`utc, board_ms, x, y, z, B`).
- **Summary every 5 min:** writes `gape-<pi>.json` (format below), then rsyncs it and the last 2 days of CSVs to gannet over SSH. This is the same upload path as the tankcams.
- **Housekeeping:** keeps 30 days of CSVs locally. Archiving the raw data long-term is a lab decision, e.g. to gannet or a data repository.
- **Mapping file:** links each board to its animal.

```yaml
# /etc/gape.yaml on the rack Pi
pi: rack-a
upload: shore@gannet.fish.washington.edu:/path/to/v1_web/gape/
loggers:
  gape-01: {tank: left-blue,  oyster: LB-01, b_closed: null}   # b_closed filled in by calibration
  gape-02: {tank: left-blue,  oyster: LB-02, b_closed: null}
  gape-03: {tank: right-blue, oyster: RB-01, b_closed: null}
```

## 3. From magnetic field to "gape"

- **Field strength:** `B = √(x² + y² + z²)`. The field from a small magnet falls off with the cube of distance, so **B is highest when the shell is closed** and drops quickly as it opens.
- **Relative gape:** `gape = (B_closed / B)^(1/3) − 1`. This is 0 when closed and grows as the valves separate. It is unitless and comparable across animals, without needing millimetres.
- **Calibrating `B_closed` per animal:** use the highest stable B seen while the oyster is closed. Take it from a gentle tap (the oyster clamps shut), or from the 99th percentile of the first day's readings. Store it in `gape.yaml`.
- **Optional, millimetres:** record B with a shim of known thickness between the valves (e.g. 2 mm) and fit a curve per animal. This is only needed if absolute gape matters for analysis.
- **Thresholds:** open/closed is decided against the animal's own range, e.g. open when gape > 25% of its typical maximum. These are per-animal and tunable.

## 4. Status rules (computed by the collector)

| Status | Rule (starting values, tune with real data) | Dashboard |
|---|---|---|
| Open | Gape above the open threshold now | ● open |
| Closed | Below the threshold now | ● closed |
| **Closed long** | Closed continuously for > 12 h | ⚠ possible stress |
| **Gaping, not closing** | Open continuously for > 6 h with no closure | ⚠ **possible mortality**, check this animal |
| Sensor problem | No readings for > 10 min, `GAPEERR` lines, or B stuck at one value | ⚠ sensor/logger |

Mortality flagging is the most valuable part. A dead oyster's valves relax open and stop moving, which shows up hours before a manual check would find it.

## 5. Summary file → dashboard

`gape-rack-a.json` (written by the collector, mirrored into the site build by `scripts/update_gape.py`, using the same fallback-to-published-copy pattern as the other feeds):

```json
{
  "updated_at": "2026-10-03T18:05:00Z",
  "pi": "rack-a",
  "loggers": [
    {
      "logger": "gape-01", "tank": "left-blue", "oyster": "LB-01",
      "last_reading": "2026-10-03T18:04:58Z",
      "state": "open", "gape": 0.21, "open_frac_24h": 0.63,
      "flags": [],
      "series_24h": [["2026-10-02T18:10Z", 0.02], ["2026-10-02T18:20Z", 0.19]]
    }
  ]
}
```

`series_24h` is downsampled to 10-minute medians, so the dashboard file stays small. The 1 Hz data stays in the CSVs.

**"Valve gape" panel:**
- **Layout:** tiles grouped by tank, using the same tank colors as the water-quality table and history chart.
- **Each tile:** oyster ID, a state chip, % of the last 24 h open, and a 24 h sparkline.
- **Flags:** ⚠ warnings sort to the top of the panel.
- **Status dot:** a feed dot in the masthead (amber if a logger is silent, red if all are).
- **Link:** each tank's group links to its Facility temperatures card, so gape can be read next to temperature.

## 6. Pilot (before wiring every tank)

1. Plug **one** logger into this Mac with the board code above, with the sensor on one oyster.
2. Run the collector locally for a day, check that readings stream, timestamps are right, and B changes when the oyster opens and closes.
3. Calibrate `B_closed`, check the open/closed threshold against direct observation, and add a pilot gape panel to the dashboard (published the same way as the seneye: the Mac pushes the summary file to a data branch).
4. Then move to the rack Pi(s) and add loggers tank by tank.

## Hardware and cabling notes

- **USB:** plain cables are fine up to 5 m. Beyond that, use an active USB extension, or a powered USB hub near the tanks with one cable back to the Pi. Several loggers can share one hub.
- **Moisture:** seal the sensor, cable and joints (potting compound, heat-shrink, or a sealed housing). Keep the logger board dry and above the waterline.
- **If the sensor-to-logger distance can't be short:**
  - lower the I²C speed in code (`busio.I2C(board.SCL, board.SDA, frequency=10000)`)
  - add an active I²C terminator (e.g. Adafruit LTC4311) for a few metres
  - use a differential I²C extender (e.g. SparkFun QwiicBus / PCA9615) for longer runs over network cable
- **Several oysters on one logger:** the TLV493D has few I²C addresses, so add an I²C multiplexer (TCA9548A), or keep one logger per oyster (simplest).
- **Power:** each logger draws power from the USB cable. A powered hub avoids overloading the Pi's ports when there are many loggers.

## Open decisions

1. How many oysters/loggers, and which tanks.
2. Sampling rate: 1 Hz is suggested; slower is fine for status, faster only matters for detailed behaviour analysis.
3. Calibration approach: relative gape only, or millimetres via shims.
4. Thresholds for "closed long" and "gaping, not closing", from the lab's experience with these animals.
5. Where raw 1 Hz CSVs are archived long-term.
6. The gannet account and path for uploads (shared with the tankcam plan).
