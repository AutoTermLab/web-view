// #/ : every glacier on a map of Greenland, since people know a glacier by where it is more than by its GID.
// The same glaciers are in a table at #/list, the keyboard and screen-reader route.
import { Map as MapLibre, NavigationControl, Popup, ScaleControl, type StyleSpecification } from "maplibre-gl";
import { loadGlaciers, type Glacier } from "../data";
import { glacierPoints } from "../points";
import { formatRoute } from "../route";
import { loadBasemap } from "./basemap";
import { el, showError } from "./common";

const MARKER_COLOR = "#0b62c4";

export function renderOverview(root: HTMLElement): () => void {
  root.className = "overview";
  root.replaceChildren(el("p", { className: "message" }, "Loading glaciers…"));
  let cleanup = () => {};
  Promise.all([loadGlaciers(), loadBasemap()]).then(
    ([{ version, glaciers }, style]) => { cleanup = mount(root, version, glaciers, style); },
    (error) => showError(root, error, () => { cleanup(); cleanup = renderOverview(root); }),
  );
  return () => cleanup();
}

function mount(root: HTMLElement, version: string, glaciers: Glacier[], style: StyleSpecification) {
  const mapBox = el("div", { className: "map" });
  root.replaceChildren(el("header", { className: "intro" },
    el("h1", {}, "AutoTerm glacier termini"),
    el("p", {}, `${glaciers.length} Greenland glaciers (data ${version}). Click one to compare its traces with the satellite scenes they were drawn on.`),
    el("a", { href: formatRoute({ view: "list" }) }, "List of all glaciers"),
  ), mapBox);

  const lons = glaciers.map((g) => g.lon), lats = glaciers.map((g) => g.lat);
  const map = new MapLibre({
    container: mapBox, style, attributionControl: { compact: true },
    bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], fitBoundsOptions: { padding: 40 },
  });
  map.addControl(new NavigationControl({ showCompass: false }));
  map.addControl(new ScaleControl({ unit: "metric" }));
  if (import.meta.env.DEV) Object.assign(window, { map }); // for the browser checks

  map.on("load", () => {
    map.addSource("glaciers", { type: "geojson", data: glacierPoints(glaciers) });
    map.addLayer({ id: "glaciers", type: "circle", source: "glaciers", paint: {
      "circle-color": MARKER_COLOR, "circle-opacity": 0.85, "circle-stroke-color": "#fff", "circle-stroke-width": 1,
      // sized by trace count (78 to 1,547 in v1)
      "circle-radius": ["interpolate", ["linear"], ["get", "traces"], 100, 4, 1500, 8],
    } });
    // Names need the basemap's fonts, which the blank fallback style doesn't have.
    if (style.glyphs) map.addLayer({ id: "labels", type: "symbol", source: "glaciers", minzoom: 5, layout: {
      "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 12,
      "text-anchor": "left", "text-offset": [0.8, 0], "text-optional": true,
    }, paint: { "text-color": "#1d2127", "text-halo-color": "#fff", "text-halo-width": 1.2 } });
    map.once("idle", () => { window.ready = true; });
  });

  const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 10 });
  map.on("mousemove", "glaciers", (e) => {
    const { id, label, traces } = e.features![0].properties;
    map.getCanvas().style.cursor = "pointer";
    popup.setLngLat(e.lngLat).setDOMContent(el("div", {},
      el("strong", {}, label), label === id ? "" : ` · ${id}`, el("br"), `${Number(traces).toLocaleString()} traces`)).addTo(map);
  });
  map.on("mouseleave", "glaciers", () => { map.getCanvas().style.cursor = ""; popup.remove(); });
  map.on("click", "glaciers", (e) => { location.hash = formatRoute({ view: "glacier", id: e.features![0].properties.id }); });

  return () => map.remove();
}
