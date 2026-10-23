import { ago, el, fill, formatTime, formatWhen, freshness, openLightbox, setStatus, slots } from "../util.js";

// Frames arrive every hour; latest.jpg is checked every ~10 min by Actions.
const OK_MIN = 90;
const WARN_MIN = 180;

export function renderWebcam(data) {
  const { meta, body } = slots("webcam");
  const latest = data.latest;
  if (!latest) {
    body.replaceChildren(el("div", { class: "skeleton", text: "No Tankcam frame available." }));
    setStatus("webcam", "bad", data.error || "no frame");
    return;
  }

  const captured = latest.captured_at ? new Date(latest.captured_at) : null;
  const level = freshness(captured, OK_MIN, WARN_MIN);
  setStatus("webcam", level, captured ? `Latest frame ${ago(captured)}` : "capture time unknown");

  const stampText = captured ? `${formatWhen(captured)} · ${ago(captured)}` : latest.local_time;
  fill(meta,
    "Frame updated every hour ",
    level !== "ok" ? el("span", { class: `badge ${level}`, text: level === "warn" ? "delayed" : "stale" }) : null,
  );

  const caption = `Live Tankcam, ${stampText}`;
  const hero = el("div", { class: "cam-hero" },
    el("img", {
      src: latest.url,
      alt: `Latest Tankcam frame from the tank room, ${stampText}`,
      onclick: () => openLightbox(latest.url, caption),
    }));

  fill(body,
    hero,
    el("p", { class: "note" },
      "Images served from ",
      el("a", { href: data.source, text: "gannet" }),
      `. Checked ${formatTime(new Date(data.updated_at))}.`),
  );
}
