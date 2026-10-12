import { el, freshness, setStatus, slots } from "../util.js";

// Tank-room logbook: a Google Sheet filled in by hand about once a week.
// Columns that are empty in every row shown are left out, so a feeding-only
// week doesn't render a table of dashes.
const COLS = [
  ["probe_ph", "Probe pH"],
  ["temp_c", "°C"],
  ["salinity", "Sal"],
  ["api_ph", "API pH"],
  ["ammonia", "NH₃"],
  ["nitrite", "NO₂⁻"],
  ["nitrate", "NO₃⁻"],
  ["water_change_gal", "Water chg (gal)"],
  ["feeding", "Fed"],
  ["tube_change", "Tube chg"],
];
const SHOW_DAYS = 4;

// "2026-10-12" is a calendar date: format it without a time-zone shift.
const day = (iso) => new Date(`${iso}T12:00:00`);
const fmtDay = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
function daysAgo(d) {
  const n = Math.round((day(new Date().toLocaleDateString("en-CA")) - d) / 86400000);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
}

export function renderLogbook(data) {
  const { meta, body } = slots("logbook");
  const days = data.days || [];
  meta.replaceChildren(el("a", { href: data.source, text: "Open logbook sheet" }));
  if (!days.length) {
    body.replaceChildren(el("div", { class: "skeleton", text: "Logbook unavailable." }));
    setStatus("logbook", "bad", data.error || "no entries");
    return;
  }

  const last = day(data.last_entry);
  const level = data.error ? "warn" : freshness(last, 60 * 24 * 8, 60 * 24 * 15);
  setStatus("logbook", level, `Last logbook entry ${daysAgo(last)}`);

  const shown = days.slice(0, SHOW_DAYS);
  const cols = COLS.filter(([k]) => shown.some((d) => d.entries.some((e) => e[k] != null)));
  const hasNotes = shown.some((d) => d.entries.some((e) => e.notes));

  const weeks = data.weeks || [];
  const strip = el("ol", { class: "lb-weeks", "aria-label": `Days logged per week, last ${weeks.length} weeks` },
    weeks.map((w) => el("li", {
      class: w.days_logged ? "on" : null,
      title: `Week of ${fmtShort.format(day(w.week_of))}: ${w.days_logged ? w.dates.map((d) => fmtShort.format(day(d))).join(", ") : "no entries"}`,
    }, el("span", { class: "sr-only", text: `Week of ${w.week_of}: ${w.days_logged} days` }))),
  );

  const table = el("table", { class: "wq lb" },
    el("caption", { class: "sr-only", text: "Most recent logbook entries" }),
    el("thead", {}, el("tr", {},
      el("th", { scope: "col", text: "Date" }),
      el("th", { scope: "col", text: "Tank" }),
      cols.map(([, label]) => el("th", { scope: "col", text: label })),
      el("th", { scope: "col", text: "By" }),
      hasNotes && el("th", { scope: "col", class: "lb-notes", text: "Notes" }),
    )),
    shown.map((d) => el("tbody", {}, d.entries.map((e, i) => el("tr", {},
      i === 0
        ? el("th", { scope: "rowgroup", rowspan: d.entries.length },
          fmtDay.format(day(d.date)), e.time ? el("small", { text: ` ${e.time}` }) : null)
        : null,
      el("td", { text: e.tank || "–" }),
      cols.map(([k]) => el("td", { text: e[k] ?? "–" })),
      el("td", { text: e.initials || "–" }),
      hasNotes && el("td", { class: "lb-notes", text: e.notes || "" }),
    )))),
  );

  body.replaceChildren(
    el("div", { class: "lb-head" },
      el("div", {},
        el("div", { class: "hero-sub", text: "Last entry" }),
        el("strong", { class: "lb-last", text: fmtDay.format(last) }),
        el("div", { class: "hero-sub", text: `${daysAgo(last)} · ${days[0].initials.join(", ") || "–"}` }),
      ),
      el("div", { class: "lb-strip" },
        el("div", { class: "hero-sub", text: `Weekly check-ins · last ${weeks.length} weeks` }),
        strip,
      ),
    ),
    el("div", { class: "table-scroll" }, table),
    el("p", { class: "note" },
      `Entries as typed in the tank-room logbook (${data.total_entries} since ${fmtShort.format(day(data.first_entry))}, ${day(data.first_entry).getFullYear()}). `,
      "The logbook is updated about once a week; this panel picks up new rows on the next site rebuild.",
    ),
  );
}
