import { el, slots } from "../util.js";

// Instagram's official embed: a blockquote per post, upgraded to an iframe by
// embed.js. Posts are hand-picked in data/instagram.json (no API token needed).
const EMBED_JS = "https://www.instagram.com/embed.js";

function loadEmbedScript() {
  if (window.instgrm) return Promise.resolve(window.instgrm);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = EMBED_JS;
    s.async = true;
    s.onload = () => resolve(window.instgrm);
    s.onerror = reject;
    document.head.append(s);
  });
}

function embed(url) {
  const permalink = url.replace(/\?.*$/, "").replace(/\/?$/, "/");
  return el("div", { class: "ig-item" }, el("div", { class: "ig-scale" },
    el("blockquote", {
      class: "instagram-media",
      "data-instgrm-permalink": `${permalink}?utm_source=ig_embed`,
      "data-instgrm-version": "14",
    }, el("a", { href: permalink, text: "View this post on Instagram" }))));
}

// The embeds are scaled with a transform, which doesn't shrink layout size;
// keep each box's height in step with its (resizing) embed.
function fitHeights(grid) {
  const scale = parseFloat(getComputedStyle(grid).getPropertyValue("--ig-scale")) || 1;
  const ro = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      target.parentElement.style.height = `${Math.ceil(target.offsetHeight * scale)}px`;
    }
  });
  grid.querySelectorAll(".ig-scale").forEach((n) => ro.observe(n));
}

export function renderInstagram(data) {
  const { meta, body } = slots("instagram");
  const profile = `https://www.instagram.com/${data.handle}/`;
  const posts = (data.posts || []).slice(0, data.show || 3);
  meta.replaceChildren(el("a", { href: profile, text: `@${data.handle}` }));

  const grid = el("div", { class: "ig-grid" }, posts.map(embed));
  body.replaceChildren(
    grid,
    el("p", { class: "note" },
      el("a", { href: profile, text: `More on Instagram →` }),
      " · Posts are picked in ",
      el("a", { href: "https://github.com/RobertsLab/shore-line/blob/main/data/instagram.json", text: "data/instagram.json" }),
      "."),
  );

  fitHeights(grid);
  loadEmbedScript()
    .then((ig) => ig?.Embeds.process())
    .catch(() => {
      // Blocked (e.g. by a content blocker): the blockquotes stay as plain links.
    });
}
