import { ago, el, fill, formatTime, freshness, setStatus, slots } from "../util.js";
import { seneyeHistory } from "./seneye.js";

const WINDOW_MS = 24 * 3600e3;

// x is time across the last 24 h (not sample index), so a short record or an
// outage shows as empty space instead of being stretched across the card.
function sparkPath(series, w = 160, h = 32, now = Date.now()) {
  if (!series?.length) {
    // gentle placeholder wave so the card reads as "a chart goes here"
    let d = "";
    for (let x = 0; x <= w; x += 4) d += `${x ? "L" : "M"}${x},${(h / 2 + Math.sin(x / 14) * 5).toFixed(1)}`;
    return d;
  }
  // Only points inside the window: older ones would all pile up at x = 0.
  series = series.filter((p) => now - new Date(p[0]) <= WINDOW_MS);
  if (!series.length) return "";  // nothing in the last 24 h: leave the chart empty
  const x = (t) => Math.max(0, Math.min(w, w - ((now - new Date(t)) / WINDOW_MS) * w)).toFixed(1);
  if (series.length < 2) return `M${x(series[0][0])},${h / 2} L${w},${h / 2}`;  // one reading so far
  const vs = series.map((p) => p[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(hi - lo, 0.2);
  return series.map((p, i) =>
    `${i ? "L" : "M"}${x(p[0])},${(h - 3 - ((p[1] - lo) / span) * (h - 6)).toFixed(1)}`).join(" ");
}

// "24 h range" only when the record actually spans ~24 h; else say since when.
function rangeLabel(series) {
  const first = series?.length ? new Date(series[0][0]) : null;
  if (!first || Date.now() - first > WINDOW_MS - 3600e3) return "24 h range";
  return `Range since ${formatTime(first)}`;
}

// Fold a seneye feed (scripts/collect_seneye.py) into its tank's system.
function withSeneye(sys, seneye) {
  if (!seneye?.latest || seneye.tank !== sys.id || seneye.latest.temp_c == null) return sys;
  const [lo, hi] = seneye.latest.alert_c || [];
  return {
    ...sys,
    status: "live",
    source: "seneye",
    alert: lo != null ? `alert ${lo}–${hi} °C` : null,
    latest: { t: seneye.latest.t, temp_c: seneye.latest.temp_c },
    series: (seneye.series || []).slice(-96).map(([t, temp]) => [t, temp]),
    extra: [
      seneye.latest.ph != null ? `pH ${seneye.latest.ph.toFixed(2)}` : null,
      seneye.latest.nh3 != null ? `NH₃ ${seneye.latest.nh3.toFixed(3)}` : null,
      seneye.latest.slide_expired ? "pH/NH₃ slide expired" : null,
    ].filter(Boolean).join(" · "),
  };
}

// "shore-temps-a" -> "Hub A"; any other folder name is shown as-is.
function hubLabel(hub) {
  const m = /^shore-temps-([a-z0-9]+)$/i.exec(hub || "");
  return m ? `Hub ${m[1].toUpperCase()}` : hub;
}

// One card per DS18B20 probe on the ESP32 hubs (scripts/update_shore_temps.py).
function probeSystems(feed, names = {}) {
  return (feed?.probes || []).map((p) => ({
    id: `probe-${p.id}`,
    name: names[p.id] || `${hubLabel(p.hub)} · ${p.id.slice(-4)}`,
    setpoint_c: null,
    status: "live",
    source: hubLabel(p.hub),
    latest: p.latest,
    series: p.series || [],
    extra: p.min_c != null ? `${rangeLabel(p.series)}: ${p.min_c.toFixed(1)}\u2060–\u2060${p.max_c.toFixed(1)}\u00a0°C · raw, uncalibrated` : null,
  })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function card(sys) {
  const live = sys.status !== "placeholder" && sys.latest?.temp_c != null;
  const at = live && sys.latest.t ? new Date(sys.latest.t) : null;
  const level = at ? freshness(at, 60, 180) : null;
  const spark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  spark.setAttribute("class", "spark");
  spark.setAttribute("viewBox", "0 0 160 32");
  spark.setAttribute("preserveAspectRatio", "none");
  spark.setAttribute("aria-hidden", "true");
  spark.innerHTML = `<path d="${sparkPath(live ? sys.series : null)}"/>`;

  const setpoint = sys.setpoint_c != null
    ? `Setpoint ${sys.setpoint_c} °C${sys.tolerance_c != null ? ` ± ${sys.tolerance_c}` : ""}`
    : "Setpoint not set";

  return el("article", { class: `card${live ? " live" : " placeholder"}` },
    el("h3", { text: sys.name }),
    // Without a sensor, show the setpoint (muted, labelled) rather than a blank.
    el("div", { class: "reading" },
      live ? sys.latest.temp_c.toFixed(1) : sys.setpoint_c != null ? sys.setpoint_c.toFixed(1) : "––.–",
      el("small", { text: " °C" })),
    spark,
    el("div", { class: "sub" },
      live ? `${sys.source || "sensor"} · ${ago(at)} ` : "Sensor not yet connected",
      live && level !== "ok" ? el("span", { class: `badge ${level}`, text: level === "warn" ? "delayed" : "stale" }) : null),
    sys.id.startsWith("probe-") ? null
      : el("div", { class: "sub", text: sys.setpoint_c != null ? `${setpoint} (default)` : setpoint }),
    live && sys.alert ? el("div", { class: "sub", text: sys.alert }) : null,
    live && sys.extra ? el("div", { class: "sub", text: sys.extra }) : null,
  );
}

export function renderTanks(data, seneye, probes) {
  const { meta, body } = slots("tanks");
  const systems = [
    ...(data.systems || []).map((s) => withSeneye(s, seneye)),
    ...probeSystems(probes, data.probes),
  ];
  const live = systems.filter((s) => s.status !== "placeholder" && s.latest?.t);

  if (live.length) {
    const newest = new Date(Math.max(...live.map((s) => new Date(s.latest.t))));
    setStatus("tanks", freshness(newest, 60, 180), `${live.length} live sensor(s), latest ${ago(newest)}`);
  } else {
    setStatus("tanks", "", "No sensor reading yet");
  }
  meta.replaceChildren(el("span", { class: "badge", text: live.length ? "live" : "no reading" }));

  fill(body,
    el("div", { class: "cards" }, systems.map(card)),
    seneyeHistory(seneye, systems.find((s) => s.id === seneye?.tank)?.name),
    el("p", { class: "note" },
      "Seneye Tank is fed by the seneye monitor; without a recent reading it shows the default setpoint. ",
      "Probe cards are DS18B20 probes on the ESP32 hubs (raw, uncalibrated; about ±0.5 °C). ",
      "The large number is the latest reading; the line is 10-min means across the last 24 h, each card on its own scale. ",
      "Names and setpoints live in ",
      el("code", { text: "data/tanks.json" }),
      "."),
  );
}
