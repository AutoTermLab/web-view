// #/list : every glacier in a table, filterable by id or name; the keyboard and screen-reader route to the glaciers on the map (#/).
import { loadGlaciers, type Glacier } from "../data";
import { formatRoute } from "../route";
import { el, showError } from "./common";

export function renderList(root: HTMLElement): () => void {
  root.className = "list";
  root.replaceChildren(el("p", { className: "message" }, "Loading glaciers…"));
  loadGlaciers().then(({ version, glaciers }) => {
    const rows = glaciers.map((g) => [g, row(g)] as const);
    const body = el("tbody", {}, ...rows.map(([, tr]) => tr));
    const search = el("input", { type: "search", placeholder: "Filter by id or name", ariaLabel: "Filter glaciers" });
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      for (const [g, tr] of rows) tr.hidden = !!q && !`${g.id} ${g.name ?? ""}`.toLowerCase().includes(q);
    };
    root.replaceChildren(
      el("p", {}, el("a", { href: formatRoute({ view: "overview" }) }, "← Map of glaciers")),
      el("h1", {}, "AutoTerm glacier termini"),
      el("p", {}, `${glaciers.length} Greenland glaciers (data ${version}). Open one to compare its traces with the satellite scenes they were drawn on.`),
      search,
      el("table", {},
        el("thead", {}, el("tr", {}, ...["Glacier", "Name", "Traces", "First", "Last"].map((h) => el("th", {}, h)))),
        body),
    );
    window.ready = true;
  }, (error) => showError(root, error, () => renderList(root)));
  return () => {};
}

function row(g: Glacier) {
  const link = el("a", { href: formatRoute({ view: "glacier", id: g.id }) }, g.id);
  return el("tr", {},
    el("td", {}, link), el("td", {}, g.name ?? "—"), el("td", { className: "num" }, g.counts.total.toLocaleString()),
    el("td", {}, g.date_range[0]), el("td", {}, g.date_range[1]));
}
