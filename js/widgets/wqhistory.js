import { el, formatDate, slots, tankColor, TANK_ORDER, TZ } from "../util.js";

// Parameter tabs. zero: anchor the y-axis at 0 (counts / concentrations);
// pH and salinity use the data range so small changes stay visible.
// concern: level at or above which a reading is worth acting on; drawn as a
// dashed line with the region above it shaded.
const PARAMS = [
  { key: "ph", label: "pH", unit: "", zero: false },
  { key: "nitrate", label: "Nitrate", unit: "ppm", zero: true, concern: 50 },
  { key: "nitrite", label: "Nitrite", unit: "ppm", zero: true, concern: 1 },
  { key: "ammonia", label: "Ammonia", unit: "ppm", zero: true, concern: 1 },
  { key: "alkalinity", label: "Alkalinity", unit: "ppm", zero: true },
  { key: "salinity_ppt", label: "Salinity", unit: "ppt", zero: false },
];
const RANGES = [{ days: 30, label: "1 month" }, { days: 92, label: "3 months" }];
const GAP_DAYS = 10;   // no line across a stretch with no reports this long
const DAY = 864e5;

const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const tick = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });

function niceStep(span) {
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw);
}

function draw(container, rows, param, days) {
  const W = Math.max(container.clientWidth, 300);
  const H = 260;
  const narrow = W < 520;
  const pad = { l: 40, r: narrow ? 12 : 104, t: 14, b: 26 };
  const now = Date.now();
  const x0 = now - days * DAY, x1 = now;

  const pts = rows
    .filter((r) => r.values[param.key] != null && new Date(r.t) >= x0)
    .map((r) => ({ t: new Date(r.t).getTime(), v: r.values[param.key], tank: r.tank, link: r.link }));

  if (!pts.length) {
    container.replaceChildren(el("div", { class: "skeleton", text: `No ${param.label.toLowerCase()} readings in this window.` }));
    return;
  }

  const vs = pts.map((p) => p.v);
  let lo = param.zero ? 0 : Math.min(...vs), hi = Math.max(...vs);
  if (param.concern != null) hi = Math.max(hi, param.concern * 1.2);
  if (hi - lo < (param.zero ? 1 : 0.4)) { hi += param.zero ? 1 : 0.2; lo -= param.zero ? 0 : 0.2; }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const tanks = [...new Set(pts.map((p) => p.tank))].sort(TANK_ORDER);
  const dodge = (tank) => (tanks.indexOf(tank) - (tanks.length - 1) / 2) * 5;
  const px = (t) => pad.l + ((t - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const py = (v) => H - pad.b - ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `${param.label} by tank over the last ${days} days` });

  for (let v = lo; v <= hi + step / 2; v += step) {
    svg.append(s("line", { class: "grid-line", x1: pad.l, x2: W - pad.r, y1: py(v), y2: py(v) }));
    const lab = s("text", { class: "axis", x: pad.l - 6, y: py(v) + 4, "text-anchor": "end" });
    lab.textContent = +v.toFixed(2);
    svg.append(lab);
  }
  if (param.concern != null) {
    const y = py(param.concern);
    svg.append(
      s("rect", { class: "concern-zone", x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: Math.max(y - pad.t, 0) }),
      s("line", { class: "concern", x1: pad.l, x2: W - pad.r, y1: y, y2: y }));
    const lab = s("text", { class: "concern-label", x: pad.l + 6, y: y - 5 });
    lab.textContent = `Concern ≥ ${param.concern} ${param.unit}`;
    svg.append(lab);
  }
  // weekly ticks
  const tickEvery = days > 45 ? 14 : 7;
  for (let t = x1; t > x0 + DAY; t -= tickEvery * DAY) {
    const lab = s("text", { class: "axis", x: px(t), y: H - 6, "text-anchor": "middle" });
    lab.textContent = tick.format(new Date(t));
    svg.append(lab);
  }

  const ends = [];
  for (const tank of tanks) {
    const series = pts.filter((p) => p.tank === tank).sort((a, b) => a.t - b.t);
    const color = tankColor(tank);
    const g = s("g", { class: "series", "aria-label": tank });
    let d = "";
    series.forEach((p, i) => {
      const cmd = i && p.t - series[i - 1].t <= GAP_DAYS * DAY ? "L" : "M";
      d += `${cmd}${(px(p.t) + dodge(tank)).toFixed(1)},${py(p.v).toFixed(1)} `;
    });
    g.append(s("path", { d, stroke: color }));
    for (const p of series) {
      g.append(s("circle", { cx: px(p.t) + dodge(tank), cy: py(p.v), r: 4, fill: color }));
    }
    svg.append(g);
    const last = series[series.length - 1];
    ends.push({ tank, y: py(last.v), color });
  }

  // Direct labels in the right margin, nudged apart so they never collide.
  if (!narrow) {
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
    const overflow = ends.length ? ends[ends.length - 1].y - (H - pad.b) : 0;
    if (overflow > 0) ends.forEach((e) => { e.y -= overflow; });
    for (const e of ends) {
      const lab = s("text", { class: "end-label", x: W - pad.r + 10, y: e.y + 4 });
      lab.textContent = e.tank;
      svg.append(s("circle", { cx: W - pad.r + 4, cy: e.y, r: 3, fill: e.color }), lab);
    }
  }

  // Hover: snap to the nearest report day, list every tank's value that day.
  const byDay = new Map();
  for (const p of pts) {
    const k = dayKey.format(new Date(p.t));
    if (!byDay.has(k)) byDay.set(k, { t: p.t, rows: [] });
    byDay.get(k).rows.push(p);
  }
  const days_ = [...byDay.values()].sort((a, b) => a.t - b.t);
  const cross = s("line", { class: "cross", y1: pad.t, y2: H - pad.b, visibility: "hidden" });
  const hit = s("rect", { x: pad.l, y: 0, width: W - pad.l - pad.r, height: H, fill: "transparent" });
  svg.append(cross, hit);
  const tip = el("div", { class: "tooltip multi", hidden: true });

  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; });
  hit.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const t = x0 + ((((e.clientX - rect.left) / rect.width) * W - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
    const day = days_.reduce((best, d) => (Math.abs(d.t - t) < Math.abs(best.t - t) ? d : best));
    const x = px(day.t);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
    tip.replaceChildren(
      el("b", { text: formatDate(new Date(day.t)) }),
      ...day.rows.slice().sort((a, b) => TANK_ORDER(a.tank, b.tank)).map((r) =>
        el("div", param.concern != null && r.v >= param.concern ? { class: "over" } : {},
          el("i", { style: `background:${tankColor(r.tank)}` }), `${r.tank}: ${r.v}${param.unit ? ` ${param.unit}` : ""}`)),
    );
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max((x / W) * 100, 12), 88)}%`;
    tip.style.top = `${pad.t + 10}px`;
    tip.style.transform = "translate(-50%, 0)";
  });

  container.replaceChildren(svg, tip);
}

export function renderWqHistory(data) {
  const { meta, body } = slots("wqh");
  const rows = data.history || [];
  if (!rows.length) {
    body.replaceChildren(el("div", { class: "skeleton", text: "No readings found in the report history." }));
    return;
  }

  const state = { param: PARAMS[0], range: RANGES[0] };
  const available = PARAMS.filter((p) => rows.some((r) => r.values[p.key] != null));
  const tanks = [...new Set(rows.map((r) => r.tank))].sort(TANK_ORDER);
  const chart = el("div", { class: "chart" });

  const group = (label, options, key, text) => {
    const wrap = el("div", { class: "filters", role: "group", "aria-label": label, style: "margin:0" });
    const buttons = options.map((o) => el("button", {
      type: "button",
      "aria-pressed": String(state[key] === o),
      text: text(o),
      onclick: () => {
        state[key] = o;
        buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(options[i] === o)));
        render();
      },
    }));
    wrap.append(...buttons);
    return wrap;
  };

  const render = () => {
    const { label, unit, concern } = state.param;
    meta.textContent = `${label}${unit ? ` (${unit})` : ""}${concern != null ? ` · concern ≥ ${concern}` : ""} · last ${state.range.label}`;
    draw(chart, rows, state.param, state.range.days);
  };

  body.replaceChildren(
    el("div", { class: "wqh-controls" },
      group("Parameter", available, "param", (p) => p.label),
      group("Time range", RANGES, "range", (r) => r.label)),
    el("ul", { class: "legend", "aria-label": "Tanks" },
      tanks.map((t) => el("li", {}, el("i", { style: `background:${tankColor(t)}` }), t))),
    chart,
    el("p", { class: "note" },
      `Each point is one reading parsed from a tank-room post. Lines break where there are no reports for ${GAP_DAYS}+ days; `,
      "points on the same day are nudged apart so overlapping tanks stay visible. ",
      el("a", { href: "data/reports.json", text: "Data (JSON)" })),
  );
  render();

  let raf;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }).observe(chart);
}
