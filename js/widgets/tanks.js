import { ago, el, freshness, setStatus, slots } from "../util.js";

function sparkPath(series, w = 160, h = 32) {
  if (!series?.length) {
    // gentle placeholder wave so the card reads as "a chart goes here"
    let d = "";
    for (let x = 0; x <= w; x += 4) d += `${x ? "L" : "M"}${x},${(h / 2 + Math.sin(x / 14) * 5).toFixed(1)}`;
    return d;
  }
  const vs = series.map((p) => p[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(hi - lo, 0.2);
  return series.map((p, i) =>
    `${i ? "L" : "M"}${((i / (series.length - 1)) * w).toFixed(1)},${(h - 3 - ((p[1] - lo) / span) * (h - 6)).toFixed(1)}`).join(" ");
}

function card(sys) {
  const live = sys.status !== "placeholder" && sys.latest?.temp_c != null;
  const spark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  spark.setAttribute("class", "spark");
  spark.setAttribute("viewBox", "0 0 160 32");
  spark.setAttribute("preserveAspectRatio", "none");
  spark.setAttribute("aria-hidden", "true");
  spark.innerHTML = `<path d="${sparkPath(live ? sys.series : null)}"/>`;

  const setpoint = sys.setpoint_c != null
    ? `Setpoint ${sys.setpoint_c} °C${sys.tolerance_c != null ? ` ± ${sys.tolerance_c}` : ""}`
    : "Setpoint not set";

  return el("article", { class: `card${live ? "" : " placeholder"}` },
    el("h3", { text: sys.name }),
    // Without a sensor, show the setpoint (muted, labelled) rather than a blank.
    el("div", { class: "reading" },
      live ? sys.latest.temp_c.toFixed(1) : sys.setpoint_c != null ? sys.setpoint_c.toFixed(1) : "––.–",
      el("small", { text: " °C" })),
    spark,
    el("div", { class: "sub", text: live ? `${setpoint} · ${ago(new Date(sys.latest.t))}` : "Sensor not yet connected" }),
    live ? null : el("div", { class: "sub", text: sys.setpoint_c != null ? `${setpoint} (default)` : setpoint }),
  );
}

export function renderTanks(data) {
  const { meta, body } = slots("tanks");
  const systems = data.systems || [];
  const anyLive = systems.some((s) => s.status !== "placeholder");

  if (anyLive) {
    const at = data.updated_at ? new Date(data.updated_at) : null;
    setStatus("tanks", freshness(at, 30, 120), at ? `Updated ${ago(at)}` : "no timestamp");
  } else {
    setStatus("tanks", "", "Placeholder: no loggers connected yet");
  }
  meta.replaceChildren(anyLive ? "" : el("span", { class: "badge", text: "placeholder data" }));

  body.replaceChildren(
    el("div", { class: "cards" }, systems.map(card)),
    el("p", { class: "note" },
      "Temperature loggers are not yet connected. These cards read ",
      el("code", { text: "data/tanks.json" }),
      ", so they fill in once a logger feed writes to it."),
  );
}
