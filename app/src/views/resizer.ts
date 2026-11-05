// The divider between the map and the glacier panel: drag it, or focus it and press ← →, to resize the panel. The
// width is remembered in this browser (a convenience only: without storage the panel starts at its default).
import { clampPanel } from "../layout";
import { el } from "./common";

const KEY = "panel-width", STEP = 32;

export function panelResizer(root: HTMLElement): HTMLElement {
  const handle = el("div", { className: "resizer", role: "separator", tabIndex: 0, title: "Drag to resize the panel" });
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize the panel");
  const width = () => root.getBoundingClientRect().right - handle.getBoundingClientRect().right;
  const set = (px: number) => root.style.setProperty("--panel-width", `${clampPanel(px, root.clientWidth)}px`);
  const save = () => { try { localStorage.setItem(KEY, String(Math.round(width()))); } catch { /* storage blocked */ } };

  handle.onpointerdown = (e) => {
    handle.setPointerCapture(e.pointerId);
    handle.onpointermove = (m) => set(root.getBoundingClientRect().right - m.clientX);
    handle.onpointerup = () => { handle.onpointermove = null; save(); };
  };
  handle.onkeydown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation(); // the view's own ← → step through the traces
    set(width() + (e.key === "ArrowLeft" ? STEP : -STEP));
    save();
  };

  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (saved) queueMicrotask(() => set(+saved)); // once the handle is in the page
  return handle;
}
