import { ago, el, formatTime, formatWhen, freshness, openLightbox, setStatus, slots } from "../util.js";

// Frames arrive every 5 min; the listing is scraped every ~10 min by Actions.
const OK_MIN = 30;
const WARN_MIN = 120;

// local_time is gannet's naive Pacific timestamp "YYYY-MM-DD HH:MM".
const frameTime = (f) => f.local_time.slice(11);
const eventTime = (f) => `${f.local_time.slice(5, 10).replace("-", "/")} ${frameTime(f)}`;

function thumb(f, label, short = frameTime) {
  return el("button", {
    type: "button",
    "aria-label": `Enlarge ${label}`,
    onclick: () => openLightbox(f.url, label),
  },
  el("img", { src: f.url, alt: "", loading: "lazy" }),
  el("span", { text: short(f) }));
}

export function renderWebcam(data) {
  const { meta, body } = slots("webcam");
  const latest = data.latest;
  if (!latest) {
    body.replaceChildren(el("div", { class: "skeleton", text: "No webcam frame available." }));
    setStatus("webcam", "bad", data.error || "no frame");
    return;
  }

  const captured = latest.captured_at ? new Date(latest.captured_at) : null;
  const level = freshness(captured, OK_MIN, WARN_MIN);
  setStatus("webcam", level, captured ? `Latest frame ${ago(captured)}` : "capture time unknown");

  const stampText = captured ? `${formatWhen(captured)} · ${ago(captured)}` : latest.local_time;
  meta.replaceChildren(
    `Camera ${latest.camera ?? "?"} · frames every 5 min `,
    level !== "ok" ? el("span", { class: `badge ${level}`, text: level === "warn" ? "delayed" : "stale" }) : null,
  );

  const caption = `Tank room, camera ${latest.camera ?? ""}, ${stampText}`;
  const hero = el("div", { class: "cam-hero" },
    el("img", {
      src: latest.url,
      alt: `Latest tank-room webcam frame, ${stampText}`,
      onclick: () => openLightbox(latest.url, caption),
    }),
    el("span", { class: "stamp", text: stampText }));

  const frames = (data.frames || []).slice(1);
  const events = data.events || [];

  body.replaceChildren(
    hero,
    frames.length ? el("p", { class: "strip-label", text: "Earlier frames" }) : null,
    frames.length ? el("div", { class: "strip" }, frames.map((f) => thumb(f, `Frame ${f.local_time}`))) : null,
    events.length ? el("p", { class: "strip-label", text: "Snapshot events" }) : null,
    events.length ? el("div", { class: "strip" }, events.map((f) => thumb(f, `Snapshot ${f.local_time}`, eventTime))) : null,
    el("p", { class: "note" },
      "Images served from ",
      el("a", { href: data.source, text: "gannet" }),
      `. Checked ${formatTime(new Date(data.updated_at))}.`),
  );
}
