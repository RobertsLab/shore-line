import { el, slots } from "../util.js";

// X's official single-post embed: a blockquote per post, upgraded to an
// iframe by widgets.js. Posts are hand-picked in data/x.json; the embedded
// timeline widget no longer renders and the read API is paid.
const WIDGETS_JS = "https://platform.twitter.com/widgets.js";

function loadWidgets() {
  if (window.twttr?.widgets) return Promise.resolve(window.twttr);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = WIDGETS_JS;
    s.async = true;
    s.charset = "utf-8";
    s.onload = () => (window.twttr?.ready ? window.twttr.ready(resolve) : resolve(window.twttr));
    s.onerror = reject;
    document.head.append(s);
  });
}

function darkMode() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function embed(url) {
  // widgets.js expects twitter.com status URLs; x.com links are rewritten.
  const href = url.replace(/^https?:\/\/(www\.)?x\.com\//, "https://twitter.com/").replace(/\?.*$/, "");
  return el("div", { class: "x-item" },
    el("blockquote", {
      class: "twitter-tweet",
      "data-dnt": "true",
      "data-theme": darkMode() ? "dark" : "light",
    }, el("a", { href, text: "View this post on X" })));
}

export function renderX(data) {
  const { meta, body } = slots("xposts");
  const profile = `https://x.com/${data.handle}`;
  const posts = (data.posts || []).slice(0, data.show || 3);
  meta.replaceChildren(el("a", { href: profile, text: `@${data.handle}` }));

  const grid = el("div", { class: "x-grid" }, posts.map(embed));
  body.replaceChildren(
    grid,
    el("p", { class: "note" },
      el("a", { href: profile, text: "More on X →" }),
      " · Posts are picked in ",
      el("a", { href: "https://github.com/RobertsLab/shore-line/blob/main/data/x.json", text: "data/x.json" }),
      "."),
  );

  loadWidgets()
    .then((tw) => tw?.widgets.load(grid))
    .catch(() => {
      // Blocked: the blockquotes stay as plain links.
    });
}
