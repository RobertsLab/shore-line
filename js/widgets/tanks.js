import { ago, el, freshness, setStatus, slots } from "../util.js";

function sparkPath(series, w = 160, h = 32) {
  if (!series?.length) {
    // gentle placeholder wave so the card reads as "a chart goes here"
    let d = "";
    for (let x = 0; x <= w; x += 4) d += `${x ? "L" : "M"}${x},${(h / 2 + Math.sin(x / 14) * 5).toFixed(1)}`;
    return d;
  }
  if (series.length < 2) return `M0,${h / 2} L${w},${h / 2}`;  // one reading so far
  const vs = series.map((p) => p[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(hi - lo, 0.2);
  return series.map((p, i) =>
    `${i ? "L" : "M"}${((i / (series.length - 1)) * w).toFixed(1)},${(h - 3 - ((p[1] - lo) / span) * (h - 6)).toFixed(1)}`).join(" ");
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
      live ? sys.latest.temp_c.toFixed(2) : sys.setpoint_c != null ? sys.setpoint_c.toFixed(1) : "––.–",
      el("small", { text: " °C" })),
    spark,
    el("div", { class: "sub" },
      live ? `${sys.source || "sensor"} · ${ago(at)} ` : "Sensor not yet connected",
      live && level !== "ok" ? el("span", { class: `badge ${level}`, text: level === "warn" ? "delayed" : "stale" }) : null),
    el("div", { class: "sub", text: sys.setpoint_c != null ? `${setpoint} (default)` : setpoint }),
    live && sys.alert ? el("div", { class: "sub", text: sys.alert }) : null,
    live && sys.extra ? el("div", { class: "sub", text: sys.extra }) : null,
  );
}

export function renderTanks(data, seneye) {
  const { meta, body } = slots("tanks");
  const systems = (data.systems || []).map((s) => withSeneye(s, seneye));
  const live = systems.filter((s) => s.status !== "placeholder" && s.latest?.t);

  if (live.length) {
    const newest = new Date(Math.max(...live.map((s) => new Date(s.latest.t))));
    setStatus("tanks", freshness(newest, 60, 180), `${live.length} live sensor(s), latest ${ago(newest)}`);
  } else {
    setStatus("tanks", "", "Placeholder: no loggers connected yet");
  }
  meta.replaceChildren(el("span", { class: "badge",
    text: live.length ? `${live.length} of ${systems.length} live · rest placeholder` : "placeholder data" }));

  body.replaceChildren(
    el("div", { class: "cards" }, systems.map(card)),
    el("p", { class: "note" },
      live.length ? "Live cards are fed by sensors (Left Blue: seneye). " : "Temperature loggers are not yet connected. ",
      "Other cards show the default setpoint from ",
      el("code", { text: "data/tanks.json" }),
      " until a sensor is connected."),
  );
}
