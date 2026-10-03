import { ago, el, formatWhen, freshness, pacificToDate, setStatus, slots } from "../util.js";

const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function drawChart(container, points, mean) {
  const W = Math.max(container.clientWidth, 280);
  const H = 220;
  const pad = { l: 36, r: 12, t: 12, b: 24 };
  const xs = points.map((p) => p.t.getTime());
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const span = Math.max(hi - lo, 0.6);
  const yLo = lo - span * 0.15, yHi = hi + span * 0.15;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const px = (t) => pad.l + ((t - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const py = (v) => H - pad.b - ((v - yLo) / (yHi - yLo)) * (H - pad.t - pad.b);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `Line chart of water temperature over the last 7 days, ${lo.toFixed(1)} to ${hi.toFixed(1)} °C` });

  // y grid: 3-4 recessive lines on 0.5 °C steps
  const step = span > 2 ? 1 : 0.5;
  for (let v = Math.ceil(yLo / step) * step; v <= yHi; v += step) {
    svg.append(s("line", { class: "grid-line", x1: pad.l, x2: W - pad.r, y1: py(v), y2: py(v) }));
    const lab = s("text", { class: "axis", x: pad.l - 6, y: py(v) + 4, "text-anchor": "end" });
    lab.textContent = v.toFixed(1);
    svg.append(lab);
  }
  // x ticks at local midnight (times are naive Pacific encoded as UTC)
  const first = new Date(x0);
  const day = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() + 1));
  for (; day.getTime() < x1; day.setUTCDate(day.getUTCDate() + 1)) {
    const x = px(day.getTime());
    if (x - pad.l < 18 || W - pad.r - x < 18) continue;
    const lab = s("text", { class: "axis", x, y: H - 6, "text-anchor": "middle" });
    lab.textContent = W < 420 && day.getUTCDay() % 2 ? "" : dayFmt.format(day);
    svg.append(lab);
  }

  const line = points.map((p, i) => `${i ? "L" : "M"}${px(xs[i]).toFixed(1)},${py(p.v).toFixed(1)}`).join(" ");
  svg.append(s("path", { class: "area", d: `${line} L${px(x1)},${H - pad.b} L${px(x0)},${H - pad.b} Z` }));
  svg.append(s("path", { class: "trace", d: line }));
  svg.append(s("line", { class: "mean", x1: pad.l, x2: W - pad.r, y1: py(mean), y2: py(mean) }));
  const ml = s("text", { class: "mean-label", x: pad.l + 6, y: py(mean) - 6 });
  ml.textContent = `7-day mean ${mean.toFixed(1)} °C`;
  svg.append(ml);
  const last = points[points.length - 1];
  svg.append(s("circle", { class: "last-dot", cx: px(x1), cy: py(last.v), r: 4.5 }));

  // crosshair + tooltip
  const cross = s("line", { class: "cross", y1: pad.t, y2: H - pad.b, visibility: "hidden" });
  const dot = s("circle", { class: "hover-dot", r: 4.5, visibility: "hidden" });
  const hit = s("rect", { x: pad.l, y: 0, width: W - pad.l - pad.r, height: H, fill: "transparent" });
  svg.append(cross, dot, hit);
  const tip = el("div", { class: "tooltip", hidden: true });

  const hide = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; };
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const t = x0 + ((mx - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
    let i = 0;
    while (i < xs.length - 1 && Math.abs(xs[i + 1] - t) < Math.abs(xs[i] - t)) i++;
    const x = px(xs[i]), y = py(points[i].v);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.style.left = `${(x / W) * 100}%`;
    tip.style.top = `${(y / H) * rect.height}px`;
    tip.textContent = `${points[i].v.toFixed(2)} °C · ${points[i].label}`;
  });

  container.replaceChildren(svg, tip);
}

export function renderField(data) {
  const { meta, body } = slots("field");
  if (!data.series?.length) {
    body.replaceChildren(el("div", { class: "skeleton", text: "NOAA data unavailable." }));
    setStatus("field", "bad", data.error || "no data");
    return;
  }

  const latestAt = pacificToDate(data.latest.t);
  const level = data.error ? "warn" : freshness(latestAt, 90, 360);
  setStatus("field", level, `Last reading ${ago(latestAt)}`);
  meta.textContent = `NOAA CO-OPS ${data.station.id} ${data.station.name}`;

  const temp = data.latest.temp_c;
  const delta = temp - data.stats.mean;
  const trend = Math.abs(delta) < 0.05 ? "at the 7-day mean" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} vs 7-day mean`;
  const points = data.series.map(([t, v]) => ({
    t: new Date(`${t}:00Z`), v,
    label: `${t.slice(5, 10).replace("-", "/")} ${t.slice(11)}`,
  }));

  const chart = el("div", { class: "chart" });
  body.replaceChildren(
    el("div", { class: "hero-num" }, el("strong", { text: temp.toFixed(1) }), el("span", { text: "°C" })),
    el("p", { class: "hero-sub", text: `${(temp * 9 / 5 + 32).toFixed(1)} °F · ${trend}` }),
    el("p", { class: "hero-sub", text: `In the water off ${data.site} · ${formatWhen(latestAt)} (${ago(latestAt)})` }),
    chart,
    el("p", { class: "note" },
      `Range ${data.stats.min.toFixed(1)}–${data.stats.max.toFixed(1)} °C over the last ${data.stats.hours / 24} days. `,
      el("a", { href: "data/field-water.json", text: "Data (JSON)" }), " · ",
      el("a", { href: data.banner, text: "Banner SVG" })),
  );

  const draw = () => drawChart(chart, points, data.stats.mean);
  draw();
  let raf;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }).observe(chart);
}
