import { el, fill, slots } from "../util.js";

const TYPE_LABEL = {
  paper: "Paper", preprint: "Preprint", dataset: "Dataset", report: "Report", notebook: "Notebook",
  presentation: "Presentation", poster: "Poster",
};

// Optional extra files for an item (e.g. paper PDF, code repo).
function extraLinks(item) {
  if (!item.links?.length) return null;
  return el("div", { class: "by" }, item.links.flatMap((l, i) => [i ? " · " : "", el("a", { href: l.url, text: l.label })]));
}

function link(item) {
  return item.doi ? `https://doi.org/${item.doi}` : item.url;
}

function feature(item) {
  return el("article", { class: `feature${item.placeholder ? " placeholder" : ""}` },
    el("span", { class: "badge", text: TYPE_LABEL[item.type] || item.type }),
    el("h3", {}, el("a", { href: link(item), text: item.title })),
    el("p", { text: [item.authors, item.venue, item.year].filter(Boolean).join(" · ") }),
  );
}

export function renderResearch(data) {
  const { meta, body } = slots("research");
  // Newest first: full date when given, else year.
  const when = (i) => i.date || String(i.year || "");
  const items = (data.items || []).slice().sort((a, b) => when(b).localeCompare(when(a)));
  const featured = items.filter((i) => i.featured).slice(0, 3);
  const rest = items.filter((i) => !featured.includes(i));
  const types = [...new Set(rest.map((i) => i.type))];
  meta.textContent = `${items.filter((i) => !i.placeholder).length} outputs`;

  const list = el("ul", { class: "pubs" });
  const draw = (type) => list.replaceChildren(...rest
    .filter((i) => !type || i.type === type)
    .map((i) => el("li", {},
      el("span", { class: "yr", text: i.year || "" }),
      el("div", {},
        el("a", { href: link(i), text: i.title }), " ",
        el("span", { class: "badge", text: TYPE_LABEL[i.type] || i.type }),
        el("div", { class: "by", text: [i.authors, i.venue].filter(Boolean).join(" · ") }),
        extraLinks(i)))));

  const filters = el("div", { class: "filters", role: "group", "aria-label": "Filter by type" });
  const buttons = [null, ...types].map((t) => el("button", {
    type: "button",
    "aria-pressed": String(t === null),
    text: t ? TYPE_LABEL[t] || t : "All",
    onclick: (e) => {
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
      draw(t);
    },
  }));
  filters.append(...buttons);
  draw(null);

  fill(body,
    featured.length ? el("div", { class: "featured" }, featured.map(feature)) : null,
    types.length > 1 ? filters : null,
    list,
    el("p", { class: "note" },
      "Curated in ",
      el("a", { href: "https://github.com/RobertsLab/shore-line/blob/main/data/research.json", text: "data/research.json" }),
      ". Add an entry to feature new work."),
  );
}
