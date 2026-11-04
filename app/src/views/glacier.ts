// #/glacier/GID278?trace=…&scene=… : the glacier's traces over the scene the selected trace was drawn on (plan §8.2).
import { Map as MapLibre, NavigationControl, ScaleControl, type ImageSource, type StyleSpecification } from "maplibre-gl";
import { DATA_BASE_URL, imageUrl, loadGlacier, type Glacier, type Traces } from "../data";
import { formatRoute } from "../route";
import { nearest, rankScenes, scenesByTrace, step, visibleTraces, type Scene, type Trace } from "../scenes";
import { inferZone, warpToMercator } from "../warp";
import { loadBasemap } from "./basemap";
import { el, showError } from "./common";

const SENSORS = ["L5", "L7", "L8", "S1", "S2"];
const SENSOR_NAMES: Record<string, string> = {
  L5: "Landsat 5", L7: "Landsat 7", L8: "Landsat 8", S1: "Sentinel-1", S2: "Sentinel-2",
};
const SENSOR_COLORS: Record<string, string> = { // Okabe–Ito, readable over imagery
  L5: "#E69F00", L7: "#56B4E9", L8: "#009E73", S1: "#F0E442", S2: "#CC79A7",
};
const SELECTED_COLOR = "#ff3b30";

type GlacierRoute = { id: string; trace?: string; scene?: string };

export function renderGlacier(root: HTMLElement, route: GlacierRoute): () => void {
  root.className = "glacier";
  root.replaceChildren(el("p", { className: "message" }, `Loading ${route.id}…`));
  let cleanup = () => {};
  Promise.all([loadGlacier(route.id), loadBasemap()]).then(
    ([{ glacier, traces, scenes }, style]) => { cleanup = mount(root, route, glacier, traces.features, scenes, style); },
    (error) => showError(root, error, () => { cleanup(); cleanup = renderGlacier(root, route); }),
  );
  return () => cleanup();
}

function mount(root: HTMLElement, route: GlacierRoute, glacier: Glacier,
               features: Traces["features"], allScenes: Scene[], style: StyleSpecification): () => void {
  const traces = features.map((f) => f.properties);
  const geometry = new Map(features.map((f) => [f.properties.trace_id, f.geometry.coordinates as [number, number][]]));
  const byId = new Map(traces.map((t) => [t.trace_id, t]));
  const sceneIndex = scenesByTrace(allScenes);
  const sensors = new Set(SENSORS.filter((s) => glacier.counts.by_sensor[s]));
  let list = visibleTraces(traces, sensors);
  let selected: string | undefined = byId.has(route.trace ?? "") ? route.trace : list[0]?.trace_id;
  let sceneId = route.scene;

  // --- panel
  const sensorBoxes = [...sensors].map((s) => {
    const box = el("input", { type: "checkbox", checked: true, value: s });
    box.onchange = () => {
      box.checked ? sensors.add(s) : sensors.delete(s);
      list = visibleTraces(traces, sensors);
      if (!list.some((t) => t.trace_id === selected)) select(nearest(list, byId.get(selected!)?.date ?? ""));
      else update();
    };
    const swatch = el("span", { className: "swatch" });
    swatch.style.background = SENSOR_COLORS[s];
    return el("label", { className: "sensor" }, box, swatch,
      `${SENSOR_NAMES[s]} (${glacier.counts.by_sensor[s].toLocaleString()})`);
  });
  const slider = el("input", { type: "range", min: "0", step: "1", ariaLabel: "Trace, by date" });
  slider.oninput = () => select(list[+slider.value]?.trace_id);
  const prev = el("button", { title: "Previous trace (←)", onclick: () => move(-1) }, "‹");
  const next = el("button", { title: "Next trace (→)", onclick: () => move(1) }, "›");
  const position = el("span", { className: "position" });
  const traceInfo = el("dl", { className: "info" });
  const sceneInfo = el("div", { className: "scene" });
  const opacity = el("input", { type: "range", min: "0", max: "1", step: "0.05", value: "1" });
  opacity.oninput = () => map.setPaintProperty("scene", "raster-opacity", +opacity.value);
  const others = el("input", { type: "checkbox", checked: false });
  others.onchange = () => map.setLayoutProperty("traces", "visibility", others.checked ? "visible" : "none");

  const mapBox = el("div", { className: "map" });
  root.replaceChildren(mapBox, el("aside", { className: "panel" },
    el("a", { href: formatRoute({ view: "overview" }) }, "← All glaciers"),
    el("h1", {}, glacier.id, glacier.name ? el("small", {}, ` ${glacier.name}`) : ""),
    el("fieldset", {}, el("legend", {}, "Sensors"), ...sensorBoxes),
    el("div", { className: "stepper" }, prev, slider, next), position,
    traceInfo, sceneInfo,
    el("label", { className: "row" }, "Image opacity", opacity),
    el("label", { className: "row" }, others, "Show the other traces"),
    el("p", { className: "hint" }, "Step through the traces by date with ← and →, or show the other traces and click one on the map."),
  ));

  // --- map
  const map = new MapLibre({
    container: mapBox, style, attributionControl: { compact: true },
    bounds: glacier.bbox, fitBoundsOptions: { padding: 40 },
  });
  map.addControl(new NavigationControl({ showCompass: false }));
  map.addControl(new ScaleControl({ unit: "metric" }));
  if (import.meta.env.DEV) Object.assign(window, { map }); // for the browser checks
  map.on("load", () => {
    map.addSource("traces", { type: "geojson", data: { type: "FeatureCollection", features } as never, promoteId: "trace_id" });
    const color = ["match", ["get", "sensor"], ...SENSORS.flatMap((s) => [s, SENSOR_COLORS[s]]), "#fff"] as never;
    map.addLayer({ id: "traces", type: "line", source: "traces", layout: { visibility: "none" },
      paint: { "line-color": color, "line-width": 1, "line-opacity": 0.55 } });
    map.addLayer({ id: "selected-casing", type: "line", source: "traces", paint: { "line-color": "#000", "line-width": 4.5, "line-opacity": 0.7 } });
    map.addLayer({ id: "selected", type: "line", source: "traces", paint: { "line-color": SELECTED_COLOR, "line-width": 2 } });
    update();
  });
  // The trace layers exist only once the map has loaded; the pointer can be over the map before that.
  map.on("click", (e) => {
    if (!map.getLayer("traces")) return;
    const { x, y } = e.point;
    const hit = map.queryRenderedFeatures([[x - 5, y - 5], [x + 5, y + 5]], { layers: ["traces", "selected"] })[0];
    if (hit) select(hit.properties.trace_id);
  });
  map.on("mousemove", (e) => {
    if (!map.getLayer("traces")) return;
    const { x, y } = e.point;
    const hit = map.queryRenderedFeatures([[x - 5, y - 5], [x + 5, y + 5]], { layers: ["traces"] }).length > 0;
    map.getCanvas().style.cursor = hit ? "pointer" : "";
  });

  function move(delta: number) { if (selected) select(step(list, selected, delta)); }
  function select(id: string | undefined) { selected = id; sceneId = undefined; update(); }

  function update() {
    const trace = selected ? byId.get(selected) : undefined;
    const ranked = trace ? rankScenes(sceneIndex.get(trace.trace_id) ?? [], geometry.get(trace.trace_id)!) : [];
    const scenes = ranked.map((r) => r.scene);
    const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
    sceneId = scene?.id;
    history.replaceState(null, "", formatRoute({ view: "glacier", id: glacier.id, trace: selected, scene: sceneId }));

    const i = list.findIndex((t) => t.trace_id === selected);
    slider.max = String(Math.max(list.length - 1, 0));
    slider.value = String(Math.max(i, 0));
    prev.disabled = i <= 0;
    next.disabled = i < 0 || i >= list.length - 1;
    position.textContent = list.length ? `Trace ${i + 1} of ${list.length.toLocaleString()}` : "No traces for these sensors";

    traceInfo.replaceChildren(...(trace ? [
      ["Date", trace.date], ["Sensor", SENSOR_NAMES[trace.sensor]], ["Season", trace.season],
      ["Uncertainty", trace.uncertainty_m == null ? "—" : `±${trace.uncertainty_m.toFixed(1)} m`], ["Trace", trace.trace_id],
    ].flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]) : []));
    renderSceneInfo(sceneInfo, trace, ranked, scene, (id) => { sceneId = id; update(); });

    if (!map.getLayer("traces")) return; // the map's load handler calls update() again
    map.setFilter("traces", ["in", ["get", "sensor"], ["literal", [...sensors]]]);
    for (const layer of ["selected", "selected-casing"]) map.setFilter(layer, ["==", ["get", "trace_id"], selected ?? ""]);
    showScene(map, scene).then(
      () => map.once("idle", () => { window.ready = true; }),
      (error) => console.error(`Could not show scene ${scene?.id}:`, error));
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== "checkbox") return; // sliders handle their own arrows
    if (e.key === "ArrowLeft") move(-1);
    if (e.key === "ArrowRight") move(1);
  };
  addEventListener("keydown", onKey);
  update();
  return () => { removeEventListener("keydown", onKey); map.remove(); };
}

let shown: string | undefined; // the scene on the map, or being loaded for it
type Corners = [[number, number], [number, number], [number, number], [number, number]];

/** Fetch the preview, warp it into Web Mercator (src/warp.ts) and show it under the traces. */
async function showScene(map: MapLibre, scene: Scene | undefined) {
  if (shown === scene?.id && map.getLayer("scene")) return;
  shown = scene?.id;
  if (map.getLayer("scene")) map.setLayoutProperty("scene", "visibility", "none"); // never show a stale scene
  if (!scene) return;

  const response = await fetch(imageUrl(DATA_BASE_URL, scene.image));
  if (!response.ok) throw new Error(`${response.status} for ${scene.image}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  const warped = warpToMercator(context.getImageData(0, 0, bitmap.width, bitmap.height), scene.corners, inferZone(scene.corners));
  if (shown !== scene.id || !map.style) return; // another scene was picked, or the view closed, meanwhile

  const image = new ImageData(warped.image.data as Uint8ClampedArray<ArrayBuffer>, warped.image.width, warped.image.height);
  const coordinates = warped.corners as Corners;
  const source = map.getSource<ImageSource>("scene");
  if (source) source.updateImage({ image, coordinates });
  else {
    map.addSource("scene", { type: "image", coordinates });
    map.getSource<ImageSource>("scene")!.updateImage({ image, coordinates });
    map.addLayer({ id: "scene", type: "raster", source: "scene", paint: { "raster-fade-duration": 0 } }, "traces");
  }
  map.setLayoutProperty("scene", "visibility", "visible");
}

function renderSceneInfo(box: HTMLElement, trace: Trace | undefined, ranked: { scene: Scene; share: number }[],
                         scene: Scene | undefined, choose: (id: string) => void) {
  if (!trace) return box.replaceChildren();
  if (!scene) return box.replaceChildren(el("p", { className: "note" }, "No scene available for this date."));
  const scenes = ranked.map((r) => r.scene);
  const k = scenes.indexOf(scene);
  const share = Math.round(ranked[k].share * 100);
  const pick = (d: number) => () => choose(scenes[(k + d + scenes.length) % scenes.length].id);
  box.replaceChildren(
    scenes.length > 1
      ? el("div", { className: "stepper" },
          el("button", { title: "Previous scene", onclick: pick(-1) }, "‹"),
          el("span", {}, `Scene ${k + 1} of ${scenes.length} on this date`),
          el("button", { title: "Next scene", onclick: pick(1) }, "›"))
      : el("p", {}, "Scene"),
    el("p", { className: "scene-id" }, scene.id),
    el("p", { className: share < 99 ? "note" : "" }, share >= 99 ? "Holds the whole trace." : `Holds ${share}% of the trace.`),
    el("p", { className: "credit" }, credit(scene)),
  );
}

function credit(scene: Scene) {
  return scene.sensor.startsWith("S")
    ? `Contains modified Copernicus Sentinel data ${scene.date.slice(0, 4)}, processed in Google Earth Engine.`
    : "Landsat imagery courtesy of the U.S. Geological Survey, processed in Google Earth Engine.";
}
