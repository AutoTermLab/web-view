// The glacier panel's year × month grid of trace counts (docs/update-plan.md §3), as plain SVG: one cell per month.
import { countClass, MONTH_SEASONS } from "../coverage";

const FIRST_YEAR = 1984, LAST_YEAR = 2022; // the span of the v1 traces
const CELL = 8, LEFT = 9; // cell size and month-label column, in viewBox units (about px in the 22rem panel)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}

/** The grid, redrawn by `draw` when the filters change; `select` outlines the selected trace's month; clicking a
 *  month with shown traces calls `pick` with its "YYYY-MM". */
export function coverageChart(sensorNames: Record<string, string>, pick: (month: string) => void) {
  const years = LAST_YEAR - FIRST_YEAR + 1;
  const x = (year: number) => LEFT + (year - FIRST_YEAR) * CELL;
  const cells = svg("g");
  const mark = svg("rect", { class: "mark", width: CELL, height: CELL, visibility: "hidden" });
  const element = svg("svg", { class: "coverage", viewBox: `0 0 ${x(LAST_YEAR + 1)} ${12 * CELL + 9}`, role: "img",
                               "aria-label": `Traces per month, ${FIRST_YEAR}–${LAST_YEAR}` },
    ...MONTHS.map((m, i) => svg("text", { x: LEFT - 2, y: (i + 0.5) * CELL, class: "month" }, m[0])),
    ...Array.from({ length: 8 }, (_, i) => 1985 + 5 * i).map((year) =>
      svg("text", { x: x(year) + CELL / 2, y: 12 * CELL + 7, class: "year" }, String(year))),
    cells, mark);

  function draw(counts: Map<string, Record<string, number>>, seasons: Set<string>) {
    cells.replaceChildren(...Array.from({ length: years }, (_, i) => FIRST_YEAR + i).flatMap((year) => MONTHS.map((name, m) => {
      const month = `${year}-${String(m + 1).padStart(2, "0")}`;
      const bySensor = Object.entries(counts.get(month) ?? {});
      const n = bySensor.reduce((sum, [, c]) => sum + c, 0);
      const shown = seasons.has(MONTH_SEASONS[m]);
      const text = n ? `${name} ${year}: ${n} trace${n > 1 ? "s" : ""} (${bySensor.map(([s, c]) => `${sensorNames[s]} ${c}`).join(", ")})`
                     : `${name} ${year}: no traces`;
      const cell = svg("rect", { x: x(year) + 0.5, y: m * CELL + 0.5, width: CELL - 1, height: CELL - 1,
                                 class: `c${countClass(n)}${shown ? "" : " dim"}${n && shown ? " pick" : ""}` },
        svg("title", {}, shown ? text : `${text}, season hidden`));
      if (n && shown) cell.onclick = () => pick(month);
      return cell;
    })));
  }

  function select(month: string | undefined) {
    const [year, m] = (month ?? "").split("-").map(Number);
    const inside = year >= FIRST_YEAR && year <= LAST_YEAR;
    mark.setAttribute("visibility", inside ? "visible" : "hidden");
    if (inside) { mark.setAttribute("x", String(x(year))); mark.setAttribute("y", String((m - 1) * CELL)); }
  }

  return { element, draw, select };
}
