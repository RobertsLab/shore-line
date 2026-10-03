import { ago, el, formatTime, formatWhen, freshness, openLightbox, setStatus, slots } from "../util.js";

// Frames arrive every 5 min; the listing is scraped every ~10 min by Actions.
const OK_MIN = 30;
const WARN_MIN = 120;

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

  body.replaceChildren(
    hero,
    el("p", { class: "note" },
      "Images served from ",
      el("a", { href: data.source, text: "gannet" }),
      `. Checked ${formatTime(new Date(data.updated_at))}.`),
  );
}
