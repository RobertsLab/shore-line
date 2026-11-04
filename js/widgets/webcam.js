import { ago, el, fill, formatTime, formatWhen, freshness, openLightbox, setStatus, slots } from "../util.js";

// Frames arrive every hour; latest.jpg is checked every ~10 min by Actions.
const OK_MIN = 90;
const WARN_MIN = 180;
const RANK = { ok: 0, warn: 1, bad: 2 };

function badge(level) {
  return level !== "ok" ? el("span", { class: `badge ${level}`, text: level === "warn" ? "delayed" : "stale" }) : null;
}

function camView(cam) {
  if (!cam.latest) {
    return {
      level: "bad",
      node: el("figure", { class: "cam" },
        el("div", { class: "cam-hero" }, el("div", { class: "skeleton", text: `No ${cam.name} frame available.` })),
        el("figcaption", {}, el("strong", { text: cam.name }), " ", badge("bad"))),
    };
  }
  const captured = cam.latest.captured_at ? new Date(cam.latest.captured_at) : null;
  const level = freshness(captured, OK_MIN, WARN_MIN);
  const stampText = captured ? `${formatWhen(captured)} · ${ago(captured)}` : "capture time unknown";
  const caption = `${cam.name}, ${stampText}`;
  return {
    level,
    captured,
    node: el("figure", { class: "cam" },
      el("div", { class: "cam-hero" },
        el("img", {
          src: cam.latest.url,
          alt: `Latest ${cam.name} frame from the tank room, ${stampText}`,
          onclick: () => openLightbox(cam.latest.url, caption),
        })),
      el("figcaption", {}, el("strong", { text: cam.name }), ` · ${stampText} `, badge(level))),
  };
}

export function renderWebcam(data) {
  const { meta, body } = slots("webcam");
  // Older webcam.json (one camera) has only `latest`.
  const cams = data.cams || (data.latest ? [{ name: "Tankcam", source: data.source, latest: data.latest }] : []);
  if (!cams.some((c) => c.latest)) {
    body.replaceChildren(el("div", { class: "skeleton", text: "No Tankcam frame available." }));
    setStatus("webcam", "bad", data.error || "no frame");
    return;
  }

  const views = cams.map(camView);
  const worst = views.reduce((w, v) => (RANK[v.level] > RANK[w] ? v.level : w), "ok");
  const newest = views.filter((v) => v.captured).map((v) => v.captured).sort((a, b) => b - a)[0];
  setStatus("webcam", worst, newest ? `${cams.length} camera(s), latest frame ${ago(newest)}` : "capture time unknown");
  fill(meta, "Frames updated every hour ", badge(worst));

  fill(body,
    el("div", { class: `cams${cams.length > 1 ? " multi" : ""}` }, views.map((v) => v.node)),
    el("p", { class: "note" },
      "Images served from gannet (",
      ...cams.flatMap((c, i) => [i ? ", " : null, el("a", { href: c.source, text: c.name })]).filter(Boolean),
      `). Checked ${formatTime(new Date(data.updated_at))}.`),
  );
}
