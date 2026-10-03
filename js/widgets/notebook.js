import { el, formatDate, slots } from "../util.js";

// Latest posts from the whole lab notebook (genefish.wordpress.com).
const SHOW = 6;

export function renderNotebook(data) {
  const { meta, body } = slots("notebook");
  const posts = data.posts || [];
  if (!posts.length) {
    body.replaceChildren(el("div", { class: "skeleton", text: "Notebook feed unavailable." }));
    return;
  }
  const site = data.source.replace(/feed\/?$/, "");
  meta.replaceChildren(el("a", { href: site, text: "genefish.wordpress.com" }));

  body.replaceChildren(
    el("ul", { class: "posts nb-grid" }, posts.slice(0, SHOW).map((p) => el("li", { class: "post" },
      el("a", { class: "title", href: p.link, text: p.title }),
      el("div", { class: "meta", text: `${formatDate(new Date(p.published))} · ${p.author}` }),
      el("p", { text: p.summary }),
    ))),
    el("p", { class: "note" }, el("a", { href: site, text: "All notebook posts →" })),
  );
}
