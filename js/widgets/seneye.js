import { el, formatWhen, pacificToDate, TZ } from "../util.js";

// pH and NH₃ history from the seneye feed, drawn as two small charts that
// share a time axis and a crosshair. zero / concern work as in wqhistory.js;
// 0.02 ppm free NH₃ is where seneye's own app starts warning.
const PARAMS = [
  { key: "ph", col: 2, label: "pH", unit: "", digits: 2, zero: false },
  { key: "nh3", col: 3, label: "NH₃ (free ammonia)", unit: "ppm", digits: 3, zero: true, concern: 0.02 },
];
const GAP_MS = 2 * 3600e3;   // break the line across missing readings / slide changes
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

// Pacific midnights strictly inside (x0, x1).
function midnights(x0, x1) {
  const out = [];
  for (let t = x0 + DAY / 2; t < x1 + DAY; t += DAY) {
    const m = pacificToDate(`${dayKey.format(new Date(t))}T00:00`).getTime();
    if (m > x0 && m < x1 && out[out.length - 1] !== m) out.push(m);
  }
  return out;
}

function drawOne(container, pts, param, x0, x1, hover) {
  const W = Math.max(container.clientWidth, 260);
  const H = 180;
  const pad = { l: 44, r: 12, t: 12, b: 24 };

  const vs = pts.map((p) => p.v);
  let lo = param.zero ? 0 : Math.min(...vs), hi = Math.max(...vs);
  if (param.concern != null) hi = Math.max(hi, param.concern * 1.2);
  const minSpan = param.zero ? 0.01 : 0.2;
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; hi = mid + minSpan / 2; lo = param.zero ? 0 : mid - minSpan / 2; }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const px = (t) => pad.l + ((t - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const py = (v) => H - pad.b - ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `${param.label} from the seneye monitor, ${Math.min(...vs)} to ${Math.max(...vs)}${param.unit ? ` ${param.unit}` : ""}` });

  for (let v = lo; v <= hi + step / 2; v += step) {
    svg.append(s("line", { class: "grid-line", x1: pad.l, x2: W - pad.r, y1: py(v), y2: py(v) }));
    const lab = s("text", { class: "axis", x: pad.l - 6, y: py(v) + 4, "text-anchor": "end" });
    lab.textContent = +v.toFixed(4);
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
  // day ticks at Pacific midnight, thinned so labels stay ~56px apart
  const days = midnights(x0, x1);
  const every = Math.max(1, Math.ceil(56 / ((W - pad.l - pad.r) / Math.max((x1 - x0) / DAY, 1))));
  days.forEach((t, i) => {
    if (i % every) return;
    const x = px(t);
    if (x - pad.l < 18 || W - pad.r - x < 18) return;
    const lab = s("text", { class: "axis", x, y: H - 6, "text-anchor": "middle" });
    lab.textContent = tick.format(new Date(t));
    svg.append(lab);
  });

  let d = "";
  pts.forEach((p, i) => {
    d += `${i && p.t - pts[i - 1].t <= GAP_MS ? "L" : "M"}${px(p.t).toFixed(1)},${py(p.v).toFixed(1)} `;
  });
  svg.append(s("path", { class: "trace", d }));
  const last = pts[pts.length - 1];
  svg.append(s("circle", { class: "last-dot", cx: px(last.t), cy: py(last.v), r: 4 }));

  const cross = s("line", { class: "cross", y1: pad.t, y2: H - pad.b, visibility: "hidden" });
  const dot = s("circle", { class: "hover-dot", r: 4, visibility: "hidden" });
  const hit = s("rect", { x: pad.l, y: 0, width: W - pad.l - pad.r, height: H, fill: "transparent" });
  svg.append(cross, dot, hit);
  const tip = el("div", { class: "tooltip", hidden: true });

  hit.addEventListener("pointerleave", () => hover(null));
  hit.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    hover(x0 + ((((e.clientX - rect.left) / rect.width) * W - pad.l) / (W - pad.l - pad.r)) * (x1 - x0));
  });

  container.replaceChildren(svg, tip);

  // Called for every chart when either one is hovered (t = null hides).
  return (t) => {
    if (t == null) {
      cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true;
      return;
    }
    const p = pts.reduce((best, q) => (Math.abs(q.t - t) < Math.abs(best.t - t) ? q : best));
    const far = Math.abs(p.t - t) > GAP_MS;   // pointer is over a gap in this series
    const x = px(far ? t : p.t), y = py(p.v);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("visibility", far ? "hidden" : "visible");
    const H_ = svg.getBoundingClientRect().height || H;
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max((x / W) * 100, 18), 82)}%`;
    tip.style.top = `${((far ? pad.t + 30 : y) / H) * H_}px`;
    tip.textContent = far ? "no reading"
      : `${p.v.toFixed(param.digits)}${param.unit ? ` ${param.unit}` : ""} · ${formatWhen(new Date(p.t))}`;
  };
}

// Returns the history block for the tanks panel, or null when the feed has
// no pH / NH₃ readings yet (e.g. no slide fitted).
export function seneyeHistory(seneye, name = "Seneye tank") {
  const rows = (seneye?.series || []).map((r) => [new Date(r[0]).getTime(), ...r.slice(1)]);
  const series = PARAMS.map((p) => rows.filter((r) => r[p.col] != null).map((r) => ({ t: r[0], v: r[p.col] })));
  if (!series.some((pts) => pts.length)) return null;

  // x range: first pH/NH₃ reading to the newest reading of any kind
  const x0 = Math.min(...series.filter((p) => p.length).map((p) => p[0].t));
  const x1 = Math.max(rows[rows.length - 1][0], x0 + 3600e3);

  const boxes = PARAMS.map(() => el("div", { class: "chart" }));
  const block = el("div", { class: "seneye-hist" },
    el("h3", { text: `${name} · pH and NH₃` }),
    el("div", { class: "seneye-charts" },
      PARAMS.map((p, i) => el("figure", {},
        el("figcaption", { text: `${p.label}${series[i].length ? "" : " · no readings"}` }),
        boxes[i]))),
    el("p", { class: "note" },
      `Readings every 30 min from the seneye slide; lines break where readings are missing for 2+ h `,
      "(including while the slide is expired or being changed). Hover either chart to compare both at that time. ",
      el("a", { href: "data/seneye.json", text: "Data (JSON)" })),
  );

  let hovers = [];
  const hover = (t) => hovers.forEach((h) => h(t));
  const draw = () => {
    hovers = PARAMS.map((p, i) => (series[i].length ? drawOne(boxes[i], series[i], p, x0, x1, hover) : () => {}));
  };
  requestAnimationFrame(draw);   // needs layout for clientWidth
  let raf;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }).observe(boxes[0]);
  return block;
}
