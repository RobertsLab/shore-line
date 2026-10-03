import { ago, el, formatDate, freshness, setStatus, slots, tankColor, TANK_ORDER } from "../util.js";

// Columns for the per-tank table, in the order the posts report them.
export const PARAMS = [
  ["salinity_ppt", "Sal ppt"],
  ["ph", "pH"],
  ["alkalinity", "Alk"],
  ["ammonia", "NH₃"],
  ["nitrite", "NO₂⁻"],
  ["nitrate", "NO₃⁻"],
];
// Values worth a second look. Flags carry a "!" as well as color.
const FLAG = {
  ammonia: (v) => v > 0.25,
  nitrite: (v) => v > 0.5,
  ph: (v) => v < 7.6 || v > 8.4,
};
// Same per-tank color as the history chart, so a tank reads the same everywhere.
const swatch = (name) => el("span", { class: "swatch", style: `background:${tankColor(name)}`, "aria-hidden": "true" });

export function renderWaterQuality(data) {
  const { meta, body } = slots("wq");
  const tanks = (data.tanks || []).slice().sort((a, b) => TANK_ORDER(a.tank, b.tank));
  if (!tanks.length) {
    body.replaceChildren(el("div", { class: "skeleton", text: "No tank readings found in recent posts." }));
    return;
  }
  const newest = new Date(Math.max(...tanks.map((t) => new Date(t.reported))));
  meta.textContent = `as reported ${formatDate(newest)}`;

  const table = el("table", { class: "wq" },
    el("caption", { class: "sr-only", text: "Most recent water-quality reading per tank" }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Tank" }), PARAMS.map(([, label]) => el("th", { scope: "col", text: label })))),
    el("tbody", {}, tanks.map((t) => el("tr", {},
      el("th", { scope: "row", style: "font-weight:600" },
        swatch(t.tank),
        el("a", { href: t.link, title: `Reported ${formatDate(new Date(t.reported))}`, text: t.tank })),
      PARAMS.map(([key]) => {
        const v = t.values[key];
        if (v == null) return el("td", { text: "–" });
        const flagged = FLAG[key]?.(v);
        return el("td", { class: flagged ? "flag" : null, text: `${v}${flagged ? " !" : ""}` });
      }),
    ))),
  );

  const older = tanks.filter((t) => newest - new Date(t.reported) > 36 * 3600 * 1000);
  body.replaceChildren(
    el("div", { class: "table-scroll" }, table),
    el("p", { class: "note" },
      "Parsed from the tank-room posts; alkalinity and nitrogen in the units used there (ppm). ",
      "! marks values worth a second look (NH₃ > 0.25, NO₂⁻ > 0.5, pH outside 7.6–8.4).",
      older.length ? ` ${older.map((t) => `${t.tank}: ${formatDate(new Date(t.reported))}`).join("; ")}.` : ""),
  );
}

export function renderReports(data) {
  const { meta, body } = slots("reports");
  const posts = data.posts || [];
  if (!posts.length) {
    body.replaceChildren(el("div", { class: "skeleton", text: "Feed unavailable." }));
    setStatus("reports", "bad", data.error || "no posts");
    return;
  }
  const newest = new Date(posts[0].published);
  const level = data.error ? "warn" : freshness(newest, 60 * 24 * 4, 60 * 24 * 14);
  setStatus("reports", level, `Last report ${ago(newest)}`);
  meta.replaceChildren(el("a", { href: data.source.replace(/feed\/?$/, ""), text: data.feed_title || "genefish" }));

  body.replaceChildren(
    el("ul", { class: "posts" }, posts.slice(0, 6).map((p) => el("li", { class: "post" },
      el("a", { class: "title", href: p.link, text: p.title }),
      el("div", { class: "meta", text: `${formatDate(new Date(p.published))} · ${p.author}` }),
      el("p", { text: p.summary }),
    ))),
    el("p", { class: "note" }, el("a", { href: data.source.replace(/feed\/?$/, ""), text: "All reports →" })),
  );
}
