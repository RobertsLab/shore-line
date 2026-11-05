import { ago, el, fill, formatTime, formatWhen, freshness, openLightbox, setStatus, slots } from "../util.js";

// Frames arrive every hour; latest.jpg is checked every ~10 min by Actions.
const OK_MIN = 90;
const WARN_MIN = 180;
const RANK = { ok: 0, warn: 1, bad: 2 };
// hls.js plays HLS where the browser can't natively (everything but Safari/iOS).
const HLS_JS = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.mjs";
const RETRY_SEC = 30;

// Live players survive the 60 s re-render, so playback isn't restarted.
const players = new Map();

function liveCam(cam) {
  const url = cam.latest?.url || cam.source;
  let p = players.get(cam.id);
  // The player shows its own state, so it never drives the panel's badge.
  if (p && p.url === url) return { level: "ok", node: p.node };
  p?.destroy();

  const video = el("video", { muted: true, autoplay: true, playsinline: true, controls: true, preload: "auto",
    "aria-label": `${cam.name} live video from the tank room` });
  video.muted = true;  // the attribute alone doesn't satisfy autoplay rules everywhere
  const state = el("span", { class: "badge", text: "connecting…" });
  p = {
    url, hls: null, timer: null,
    node: el("figure", { class: "cam video" },
      el("div", { class: "cam-hero" }, video),
      el("figcaption", {}, el("strong", { text: cam.name }), " · live video ", state)),
    destroy() { clearTimeout(this.timer); this.hls?.destroy(); video.removeAttribute("src"); video.load(); },
  };
  players.set(cam.id, p);

  const set = (text, level) => {
    state.textContent = text;
    state.className = `badge${level === "ok" ? " live" : ` ${level}`}`;
  };
  const retry = () => { clearTimeout(p.timer); p.timer = setTimeout(start, RETRY_SEC * 1000); };
  video.addEventListener("playing", () => set("● live", "ok"));
  video.addEventListener("waiting", () => set("buffering…", "warn"));

  async function start() {
    set("connecting…", "warn");
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.onerror = () => { set("stream unavailable", "bad"); retry(); };
      video.play().catch(() => {});
      return;
    }
    try {
      const { default: Hls } = await import(HLS_JS);
      if (!Hls.isSupported()) return set("video not supported in this browser", "bad");
      p.hls?.destroy();
      p.hls = new Hls({ liveSyncDurationCount: 2, manifestLoadingMaxRetry: 2 });
      p.hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        console.warn(`${cam.name}: ${d.type} / ${d.details}`);
        set("stream unavailable", "bad");
        p.hls.destroy(); p.hls = null;
        retry();
      });
      p.hls.loadSource(url);
      p.hls.attachMedia(video);
      p.hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    } catch (err) {
      console.warn(err);
      set("stream unavailable", "bad");
      retry();
    }
  }
  start();
  return { level: "ok", node: p.node };
}

function badge(level) {
  return level !== "ok" ? el("span", { class: `badge ${level}`, text: level === "warn" ? "delayed" : "stale" }) : null;
}

function camView(cam) {
  if (cam.kind === "hls") return liveCam(cam);
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

  // Live video first, full width; snapshots below.
  const ordered = [...cams].sort((a, b) => (b.kind === "hls") - (a.kind === "hls"));
  const views = ordered.map(camView);
  const worst = views.reduce((w, v) => (RANK[v.level] > RANK[w] ? v.level : w), "ok");
  const newest = views.filter((v) => v.captured).map((v) => v.captured).sort((a, b) => b - a)[0];
  setStatus("webcam", worst, newest ? `${cams.length} camera(s), latest frame ${ago(newest)}` : "capture time unknown");
  fill(meta, cams.some((c) => c.kind === "hls") ? "Live video + hourly frames " : "Frames updated every hour ", badge(worst));

  fill(body,
    el("div", { class: `cams${cams.length > 1 ? " multi" : ""}` }, views.map((v) => v.node)),
    el("p", { class: "note" },
      "Images served from gannet (",
      ...ordered.flatMap((c, i) => [i ? ", " : null, el("a", { href: c.source, text: c.name })]).filter(Boolean),
      `). Checked ${formatTime(new Date(data.updated_at))}.`),
  );
}
