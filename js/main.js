import { loadJSON, setStatus, showError } from "./util.js";
import { renderWebcam } from "./widgets/webcam.js";
import { renderField } from "./widgets/field.js";
import { renderTanks } from "./widgets/tanks.js";
import { renderReports, renderWaterQuality } from "./widgets/reports.js";
import { renderResearch } from "./widgets/research.js";

// Each widget reads one JSON file; a failure only blanks that widget.
const WIDGETS = [
  { file: "data/webcam.json", feed: "webcam", render: renderWebcam, ids: ["webcam"], refreshSec: 60 },
  { file: "data/field-water.json", feed: "field", render: renderField, ids: ["field"], refreshSec: 600 },
  { file: "data/tanks.json", feed: "tanks", render: renderTanks, ids: ["tanks"], refreshSec: 300 },
  { file: "data/reports.json", feed: "reports", render: (d) => { renderWaterQuality(d); renderReports(d); }, ids: ["wq", "reports"], refreshSec: 900 },
  { file: "data/research.json", render: renderResearch, ids: ["research"] },
];

async function load(w) {
  try {
    w.render(await loadJSON(w.file));
  } catch (err) {
    console.error(err);
    w.ids.forEach((id) => showError(id, `Could not load ${w.file}`));
    if (w.feed) setStatus(w.feed, "bad", String(err));
  }
}

for (const w of WIDGETS) {
  load(w);
  if (w.refreshSec) {
    setInterval(() => { if (!document.hidden) load(w); }, w.refreshSec * 1000);
  }
}
