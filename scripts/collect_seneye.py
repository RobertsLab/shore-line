#!/usr/bin/env python3
"""
Read the current water readings from a Seneye Web Server (SWS) on the lab
network and append them to a small JSON history the dashboard can fetch.

The SWS has no JSON API. Its web page opens ws://<host>/ and, on connect,
receives one BSON message {c: 0, d: <865-byte struct>} holding the whole
device state, including the latest temperature / pH / NH3 reading. The
struct layout below is transcribed from the SWS page script (jParser
definitions in a.js): little-endian, and every run of bit fields occupies
one uint32.

The SWS sits on a private UW address, so this must run on a machine inside
the network (e.g. gannet, or a lab Mac via cron/launchd), writing to a path
that is web-served. The site build then picks the file up (SENEYE_URL).

Standard library only.

Usage:
    python scripts/collect_seneye.py                      # print one reading
    python scripts/collect_seneye.py --out /path/seneye.json [--tank left-blue]
"""

import argparse
import base64
import json
import os
import socket
import struct
import sys
import time
from datetime import datetime, timedelta, timezone

HOST = os.environ.get("SENEYE_HOST", "172.25.149.26")
KEEP_DAYS = 14

# --------------------------------------------------------------------------
# minimal WebSocket client: handshake, then read one complete message
# --------------------------------------------------------------------------

def _recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("socket closed")
        buf += chunk
    return buf


def ws_first_binary_message(host, port=80, timeout=15):
    key = base64.b64encode(os.urandom(16)).decode()
    sock = socket.create_connection((host, port), timeout=timeout)
    try:
        sock.sendall((
            f"GET / HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += _recv_exact(sock, 1)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError(f"no websocket upgrade: {head[:80]!r}")

        message = b""
        while True:
            b1, b2 = _recv_exact(sock, 2)
            fin, opcode, n = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", _recv_exact(sock, 2))[0]
            elif n == 127:
                n = struct.unpack(">Q", _recv_exact(sock, 8))[0]
            mask = _recv_exact(sock, 4) if b2 & 0x80 else None
            payload = _recv_exact(sock, n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:
                raise ConnectionError("server closed connection")
            if opcode in (0x2, 0x0):  # binary / continuation
                message += payload
                if fin:
                    return message
            # ignore text / ping / pong frames
    finally:
        sock.close()


def bson_doc(buf):
    """Just enough BSON for the SWS envelope: int32, binary, string, bool, doc."""
    out, i = {}, 4
    while i < len(buf) - 1:
        kind = buf[i]
        i += 1
        end = buf.index(b"\0", i)
        key = buf[i:end].decode()
        i = end + 1
        if kind == 0x10:
            out[key] = struct.unpack_from("<i", buf, i)[0]; i += 4
        elif kind == 0x05:
            n = struct.unpack_from("<i", buf, i)[0]; out[key] = buf[i + 5:i + 5 + n]; i += 5 + n
        elif kind == 0x02:
            n = struct.unpack_from("<i", buf, i)[0]; out[key] = buf[i + 4:i + 3 + n].decode("latin-1"); i += 4 + n
        elif kind == 0x08:
            out[key] = bool(buf[i]); i += 1
        elif kind == 0x03:
            n = struct.unpack_from("<i", buf, i)[0]; out[key] = bson_doc(buf[i:i + n]); i += n
        else:
            raise ValueError(f"unsupported BSON type {kind:#x}")
    return out

# --------------------------------------------------------------------------
# jParser-compatible struct reader
# --------------------------------------------------------------------------

def F(kind, scale):
    return ("_f", kind, scale)


COLOR = {"g": "uint16", "r": "uint16", "b": "uint16", "w": "uint16"}
TYPES = {
    "net": {"extip": "uint32", "locip": "uint32", "extp": "uint16", "_reserved": "uint16"},
    "led": {"don": 1, "rpt": 3, "m": 24},  # SWS source has duplicate key m; JS keeps the last
    "html": {"type": "uint8", "_reserved": "uint8", "ver": "uint16"},
    "sinfoflag": {"t_unit": 1, "registered": 1, "autologin": 1, "beta": 1, "lde": 1},
    "sinfo": {"swsver": "_v", "devtype": "uint8", "locale": ("string", 6), "name": ("string", 160),
              "autologin": ("string", 256), "flags": "sinfoflag"},
    "color": COLOR,
    "sud_info": {"bits": {"is_connected": 1, "not_supported": 1, "not_sud": 1, "is_bootloaded": 1,
                          "fw_error": 1, "fw_completed": 1},
                 "type": "uint8", "firmware": "_v", "serial": ("string", 33),
                 "name": ("string", 105), "offline": "uint16"},
    "sud_lm": {"is_kelvin": "uint32", "color": "color", "kelvin": F("int32", .001),
               "x": F("int32", 1e-4), "y": F("int32", 1e-4), "par": "int32", "lux": "int32"},
    "sud_reading": {"ts": "uint32",
                    "bits": {"typet": 2, "inwater": 1, "slidenotfitted": 1, "slideexpired": 1,
                             "state_t": 2, "state_ph": 2, "state_nh3": 2},
                    "ph": F("uint16", .01), "nh3": F("uint16", .001), "t": F("int32", .001),
                    "phcolor": "color", "nh3color": "color",
                    "lm": {"color": "color", "kelvin": F("int32", .001), "x": F("int32", 1e-4),
                           "y": F("int32", 1e-4), "par": "int32", "lux": "int32"}},
    "sud_warning": {"state_ph": 2, "state_nh3": 2, "state_t": 2, "inwater": 1,
                    "slidenotfitted": 1, "slideexpired": 1},
    "sud_habitat": {"marine_tick": "uint32", "t_max": F("int32", .001), "t_min": F("int32", .001),
                    "t_trim": F("int16", .001), "ph_max": F("uint16", .01), "ph_min": F("uint16", .01),
                    "ph_trim": F("int16", .01), "nh3_th": F("uint16", .001), "nh3_trim": F("int16", .001)},
    "sud_slide": {"type": 8, "expire": "uint32", "code": ("string", 20)},
    "sud_ondemand": {"ts": "uint32", "lr": "uint16", "tr": "uint16"},
    "sud_lmi": {"step": "uint8"},
    "sud_leds": {"t": 2, "nh3": 2, "ph": 2, "slide": 2, "scan": 2},
    "sud": {"info": "sud_info", "warning": "sud_warning", "reading": "sud_reading",
            "habitat": "sud_habitat", "slide": "sud_slide", "lm": "sud_lm",
            "ondemand": "sud_ondemand", "lmi": "sud_lmi", "leds": "sud_leds"},
    "bstate": {"LAN": 1, "WAN": 2, "UPNP": 1, "RTC": 1, "SENEYESERVER": 1, "PROFILE": 1},
    "slde": {"ts": "uint32", "state": "int16", "_reserved": "int16"},
    "slke": {"is_connected": "uint32", "alarm": "uint32", "ts": "uint32"},
    "slwd": {"f1": "uint32", "f2": "uint32", "ts": "uint32", "a": "uint32"},
    "nstate": {"A1": 1, "A2": 1, "A3": 1, "A4": 1, "A5": 1},
    "sws": {"layout": ("array", "uint8", 32), "label": ("string", 12), "html": "html", "net": "net",
            "flags": "bstate", "info": "sinfo",
            "leds": {"l1": "led", "l2": "led", "l3": "led", "l4": "led", "l5": "led", "l6": "led"},
            "lde": "slde", "lek": "slke", "lwd": "slwd", "ns": "nstate", "sud": ("array", "sud", 1)},
}
PRIM = {"uint8": "<B", "int8": "<b", "uint16": "<H", "int16": "<h", "uint32": "<I", "int32": "<i"}


class Reader:
    def __init__(self, buf):
        self.buf, self.pos = buf, 0
        self.bits = None  # (uint32 value, shift) while inside a bit-field run

    def prim(self, kind):
        fmt = PRIM[kind]
        v = struct.unpack_from(fmt, self.buf, self.pos)[0]
        self.pos += struct.calcsize(fmt)
        return v

    def parse(self, spec):
        if isinstance(spec, int):  # bit field: runs share one little-endian uint32
            if self.bits is None:
                self.bits = (self.prim("uint32"), 0)
            word, shift = self.bits
            self.bits = (word, shift + spec)
            return (word >> shift) & ((1 << spec) - 1)
        self.bits = None
        if isinstance(spec, str):
            if spec in PRIM:
                return self.prim(spec)
            if spec == "_v":
                a = self.prim("uint16")
                return f"{a // 10000}.{a // 100 % 100}.{a % 100}"
            return self.parse(TYPES[spec])
        if isinstance(spec, tuple):
            if spec[0] == "_f":
                return round(self.parse(spec[1]) * spec[2], 4)
            if spec[0] == "string":
                raw = self.buf[self.pos:self.pos + spec[1]]
                self.pos += spec[1]
                return raw.split(b"\0", 1)[0].decode("latin-1")
            if spec[0] == "array":
                return [self.parse(spec[1]) for _ in range(spec[2])]
        if isinstance(spec, dict):
            return {k: self.parse(v) for k, v in spec.items()}
        raise ValueError(f"unknown spec {spec!r}")

# --------------------------------------------------------------------------

def read_device(host=HOST):
    msg = bson_doc(ws_first_binary_message(host))
    if msg.get("c") != 0 or not isinstance(msg.get("d"), (bytes, bytearray)):
        raise ValueError(f"unexpected first message c={msg.get('c')}")
    state = Reader(bytes(msg["d"])).parse("sws")
    sud = state["sud"][0]
    r = sud["reading"]
    bits = r["bits"]
    # pH / NH3 come from the chemical slide; when it is missing or expired the
    # device still reports 0.0, which is not a reading.
    slide_ok = not bits["slidenotfitted"] and not bits["slideexpired"]
    return {
        "t": datetime.fromtimestamp(r["ts"], timezone.utc).isoformat() if r["ts"] else None,
        "temp_c": r["t"],
        "ph": r["ph"] if slide_ok else None,
        "nh3": r["nh3"] if slide_ok else None,
        "in_water": bool(bits["inwater"]),
        "slide_fitted": not bits["slidenotfitted"],
        "slide_expired": bool(bits["slideexpired"]),
        "alert_c": [sud["habitat"]["t_min"], sud["habitat"]["t_max"]],
        "lux": r["lm"]["lux"],
        "par": r["lm"]["par"],
        "device": {
            "name": sud["info"]["name"] or state["info"]["name"],
            "connected": bool(sud["info"]["bits"]["is_connected"]),
            "firmware": sud["info"]["firmware"],
            "sws_version": state["info"]["swsver"],
        },
    }


def append(path, reading, tank):
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        doc = {"tank": tank, "series": []}
    doc.update({
        "tank": tank,
        "source": "seneye",
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "device": reading["device"],
        "latest": {k: v for k, v in reading.items() if k != "device"},
    })
    row = [reading["t"], reading["temp_c"], reading["ph"], reading["nh3"]]
    if reading["t"] and (not doc["series"] or doc["series"][-1][0] != reading["t"]):
        doc["series"].append(row)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).isoformat()
    doc["series"] = [r for r in doc["series"] if r[0] >= cutoff]
    doc["series_fields"] = ["t", "temp_c", "ph", "nh3"]
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1)
    os.replace(tmp, path)  # atomic, so the web server never serves half a file


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--host", default=HOST)
    ap.add_argument("--out", help="JSON file to append to (omit to just print)")
    ap.add_argument("--tank", default="left-blue", help="tanks.json system id")
    args = ap.parse_args()

    # The SWS serves one websocket client at a time; if someone has its web
    # page open the connection is refused, so retry a few times.
    for attempt in range(1, 5):
        try:
            reading = read_device(args.host)
            break
        except (OSError, ValueError, ConnectionError) as exc:
            print(f"seneye {args.host} (try {attempt}): {exc}", file=sys.stderr)
            time.sleep(10)
    else:
        return 1

    print(json.dumps(reading, indent=1))
    if args.out:
        append(args.out, reading, args.tank)
        print(f"appended to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
