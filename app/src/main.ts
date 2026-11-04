import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "./styles.css";
import { parseRoute } from "./route";
import { renderGlacier } from "./views/glacier";
import { renderList } from "./views/list";

declare global {
  interface Window { ready?: boolean } // set once a view has finished loading (for the screenshot tool)
}

// MapLibre looks for its worker next to its own module, which the bundler moves; point it at the copied file instead.
setWorkerUrl(workerUrl);

const app = document.getElementById("app")!;
let teardown: (() => void) | undefined;

function render() {
  teardown?.();
  window.ready = false;
  const route = parseRoute(location.hash);
  teardown = route.view === "glacier" ? renderGlacier(app, route) : renderList(app);
}

addEventListener("hashchange", render);
render();
