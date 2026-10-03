// Shared helpers for the SHORE widgets.

export const TZ = "America/Los_Angeles";

export async function loadJSON(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// replaceChildren() that skips null/false parts (the native one prints "null").
export function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}

export function slots(sectionId) {
  const root = document.getElementById(sectionId);
  return {
    root,
    meta: root.querySelector('[data-slot="meta"]'),
    body: root.querySelector('[data-slot="body"]'),
  };
}

export function showError(sectionId, message) {
  const { body } = slots(sectionId);
  body.replaceChildren(el("div", { class: "skeleton", text: message }));
}

// "2026-10-02T19:12" in Pacific local time -> Date (DST-aware).
export function pacificToDate(local) {
  const asUTC = new Date(`${local}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).formatToParts(asUTC).map((p) => [p.type, p.value]),
  );
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(asUTC.getTime() + (asUTC.getTime() - shown));
}

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const fmtDate = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

export const formatWhen = (d) => fmt.format(d);
export const formatDate = (d) => fmtDate.format(d);
export const formatTime = (d) => fmtTime.format(d);

export function ago(date, now = new Date()) {
  const s = Math.round((now - date) / 1000);
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// Feed health shown in the masthead status strip.
export function setStatus(feed, level, detail) {
  const li = document.querySelector(`#status [data-feed="${feed}"]`);
  if (!li) return;
  li.querySelector(".dot").className = `dot ${level}`;
  li.title = detail;
}

export function freshness(date, okMinutes, warnMinutes) {
  if (!date) return "bad";
  const mins = (Date.now() - date) / 60000;
  if (mins <= okMinutes) return "ok";
  if (mins <= warnMinutes) return "warn";
  return "bad";
}

export function openLightbox(src, caption) {
  const dlg = document.getElementById("lightbox");
  dlg.querySelector("img").src = src;
  dlg.querySelector("img").alt = caption;
  dlg.querySelector("p").textContent = caption;
  dlg.showModal();
}
document.getElementById("lightbox")?.addEventListener("click", (e) => {
  if (e.target.id === "lightbox" || e.target.tagName === "IMG") e.currentTarget.close();
});

// Tank identity colors (dataviz categorical slots 1-4, see css --s1..--s4).
// Fixed per tank so a tank keeps its color when others drop out of view.
const TANK_SLOT = { "Left Blue": 1, "Left Yellow": 2, "Right Blue": 3, "Right Yellow": 4 };
export function tankColor(name) {
  return `var(--s${TANK_SLOT[name] ?? 1})`;
}
export const TANK_ORDER = (a, b) => (TANK_SLOT[a] ?? 9) - (TANK_SLOT[b] ?? 9) || a.localeCompare(b);
