// #/glacier/GID278?trace=…&scene=…&season=JJA&color=season : the glacier's traces over the scene the selected trace was
// drawn on (plan §8.2).
import { Map as MapLibre, NavigationControl, ScaleControl, type ImageSource, type StyleSpecification } from "maplibre-gl";
import { SEASON_COLORS, SENSOR_COLORS, traceColor } from "../colors";
import { coverage } from "../coverage";
import { DATA_BASE_URL, imageUrl, loadGlacier, loadGlaciers, type Glacier, type Traces } from "../data";
import { formatRoute } from "../route";
import { nearest, rankScenes, scenesByTrace, step, visibleTraces, type Scene, type Trace } from "../scenes";
import { inferZone, warpToMercator } from "../warp";
import { loadBasemap } from "./basemap";
import { el, showError } from "./common";
import { coverageChart } from "./coverage";
import { panelResizer } from "./resizer";

const SENSORS = ["L5", "L7", "L8", "S1", "S2"];
const SENSOR_NAMES: Record<string, string> = {
  L5: "Landsat 5", L7: "Landsat 7", L8: "Landsat 8", S1: "Sentinel-1", S2: "Sentinel-2",
};
const SEASONS = ["DJF", "MAM", "JJA", "SON"]; // meteorological (plan §6.3)
const SEASON_MONTHS: Record<string, string> = {
  DJF: "December–February", MAM: "March–May", JJA: "June–August", SON: "September–November",
};
const SELECTED_COLOR = "#ff3b30";

type GlacierRoute = { id: string; trace?: string; scene?: string; seasons?: string[]; color?: "season" };

export function renderGlacier(root: HTMLElement, route: GlacierRoute): () => void {
  root.className = "glacier";
  root.replaceChildren(el("p", { className: "message" }, `Loading ${route.id}…`));
  let cleanup = () => {}, closed = false;
  // The map starts on its basemap as soon as the glacier's box is known (glaciers.json, usually cached), while the
  // traces and scene index download: basemap tiles are often the slowest part (plan §12).
  const data = loadGlacier(route.id);
  data.catch(() => {}); // handled below; this only stops an unhandled-rejection warning if glaciers.json fails first
  Promise.all([loadGlaciers(), loadBasemap()]).then(async ([{ glaciers }, style]) => {
    if (closed) return; // left before the basemap arrived
    const glacier = glaciers.find((g) => g.id === route.id);
    if (!glacier) return void await data; // rejects with "No glacier …"
    const mapBox = el("div", { className: "map" });
    const panel = el("aside", { className: "panel" }, el("p", { className: "message" }, `Loading ${route.id}…`));
    root.replaceChildren(mapBox, panelResizer(root), panel);
    const map = createMap(mapBox, glacier, style);
    cleanup = () => map.remove();
    const { traces, scenes } = await data;
    if (!closed) cleanup = mount(map, panel, route, glacier, traces.features, scenes);
  }).catch((error) => {
    if (closed) return;
    cleanup();
    cleanup = () => {};
    showError(root, error, () => { cleanup = renderGlacier(root, route); });
  });
  return () => { closed = true; cleanup(); };
}

function createMap(container: HTMLElement, glacier: Glacier, style: StyleSpecification) {
  const map = new MapLibre({
    container, style, attributionControl: { compact: true }, bounds: glacier.bbox, fitBoundsOptions: { padding: 40 },
  });
  map.addControl(new NavigationControl({ showCompass: false }));
  map.addControl(new ScaleControl({ unit: "metric" }));
  if (import.meta.env.DEV) Object.assign(window, { map }); // for the browser checks
  return map;
}

/** Run `fn` once the style is parsed, which is all addLayer needs: the "load" event also waits for every basemap
 *  tile on screen, which held back the traces and the scene by seconds on a cold tile cache. */
function onStyle(map: MapLibre, fn: () => void) {
  if (map.style?._loaded) fn();
  else map.once("style.load", fn);
}

function mount(map: MapLibre, panel: HTMLElement, route: GlacierRoute, glacier: Glacier,
               features: Traces["features"], allScenes: Scene[]): () => void {
  const traces = features.map((f) => f.properties);
  const geometry = new Map(features.map((f) => [f.properties.trace_id, f.geometry.coordinates as [number, number][]]));
  const byId = new Map(traces.map((t) => [t.trace_id, t]));
  const sceneIndex = scenesByTrace(allScenes);
  const sensors = new Set(SENSORS.filter((s) => glacier.counts.by_sensor[s]));
  const chosen = SEASONS.filter((s) => route.seasons?.includes(s));
  const seasons = new Set(chosen.length ? chosen : SEASONS);
  let list = visibleTraces(traces, sensors, seasons);
  let selected = list.some((t) => t.trace_id === route.trace) ? route.trace : list[0]?.trace_id;
  let sceneId = route.scene;

  // --- panel
  const swatch = (color: string) => {
    const span = el("span", { className: "swatch" });
    span.style.background = color;
    return span;
  };
  const sensorBoxes = [...sensors].map((s) => {
    const box = el("input", { type: "checkbox", checked: true, value: s });
    box.onchange = () => { box.checked ? sensors.add(s) : sensors.delete(s); refilter(); };
    return el("label", { className: "sensor" }, box, swatch(SENSOR_COLORS[s]),
      `${SENSOR_NAMES[s]} (${glacier.counts.by_sensor[s].toLocaleString()})`);
  });
  const seasonBoxes = SEASONS.map((s) => {
    const box = el("input", { type: "checkbox", checked: seasons.has(s), value: s });
    box.onchange = () => { box.checked ? seasons.add(s) : seasons.delete(s); refilter(); };
    const count = traces.filter((t) => t.season === s).length;
    return el("label", { className: "season", title: SEASON_MONTHS[s] }, box, swatch(SEASON_COLORS[s]),
      `${s} (${count.toLocaleString()})`);
  });
  const chart = coverageChart(SENSOR_NAMES, (month) => select(list.find((t) => t.date.startsWith(month))?.trace_id));
  chart.draw(coverage(traces, sensors), seasons);
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
  // The swatches beside the sensor or the season boxes are the legend; CSS shows the set that matches.
  const bySeason = el("input", { type: "checkbox", role: "switch", checked: route.color === "season" });
  bySeason.onchange = () => {
    panel.dataset.colorBy = bySeason.checked ? "season" : "sensor";
    map.setPaintProperty("traces", "line-color", traceColor(bySeason.checked ? "season" : "sensor") as never);
    update();
  };
  panel.dataset.colorBy = bySeason.checked ? "season" : "sensor";

  panel.replaceChildren(
    el("a", { href: formatRoute({ view: "overview" }) }, "← All glaciers"),
    el("h1", {}, glacier.id, glacier.name ? el("small", {}, ` ${glacier.name}`) : ""),
    el("fieldset", {}, el("legend", {}, "Sensors"), ...sensorBoxes),
    el("label", { className: "row" }, bySeason, "Color the traces by season"),
    el("fieldset", {}, el("legend", {}, "Seasons"), el("div", { className: "seasons" }, ...seasonBoxes),
      el("p", { className: "hint" }, "Winter (DJF) traces are nearly all from 2015 on, and mostly Sentinel-1 radar: optical " +
        "sensors see nothing in the polar night. Comparing seasons mostly compares recent years.")),
    el("section", { className: "coverage-box" }, el("h2", {}, "Traces per month"), chart.element,
      el("p", { className: "legend" }, ...["none", "1", "2–3", "4–7", "8–15", "16+"].flatMap((label, i) =>
        [el("span", { className: `c${i}` }), `${label} `]))),
    el("div", { className: "stepper" }, prev, slider, next), position,
    traceInfo, sceneInfo,
    el("label", { className: "row" }, "Image opacity", opacity),
    el("label", { className: "row" }, others, "Show the other traces"),
    el("p", { className: "hint" }, "Step through the traces by date with ← and →, or show the other traces and click one on the map."),
  );

  // --- map
  onStyle(map, () => {
    map.addSource("traces", { type: "geojson", data: { type: "FeatureCollection", features } as never, promoteId: "trace_id" });
    map.addLayer({ id: "traces", type: "line", source: "traces", layout: { visibility: "none" },
      paint: { "line-color": traceColor(bySeason.checked ? "season" : "sensor") as never, "line-width": 1, "line-opacity": 0.55 } });
    map.addLayer({ id: "selected-casing", type: "line", source: "traces", paint: { "line-color": "#000", "line-width": 4.5, "line-opacity": 0.7 } });
    map.addLayer({ id: "selected", type: "line", source: "traces", paint: { "line-color": SELECTED_COLOR, "line-width": 2 } });
    update();
  });
  // The trace layers exist only once the style has loaded and the data has arrived; the pointer can be over the map before that.
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

  /** Apply the sensor and season choices; keep the selected trace if it is still shown, else the nearest by date. */
  function refilter() {
    list = visibleTraces(traces, sensors, seasons);
    chart.draw(coverage(traces, sensors), seasons);
    if (!list.some((t) => t.trace_id === selected)) select(nearest(list, byId.get(selected!)?.date ?? ""));
    else update();
  }
  function move(delta: number) { if (selected) select(step(list, selected, delta)); }
  function select(id: string | undefined) { selected = id; sceneId = undefined; update(); }

  function update() {
    const trace = selected ? byId.get(selected) : undefined;
    const ranked = trace ? rankScenes(sceneIndex.get(trace.trace_id) ?? [], geometry.get(trace.trace_id)!) : [];
    const scenes = ranked.map((r) => r.scene);
    const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
    sceneId = scene?.id;
    history.replaceState(null, "", formatRoute({ view: "glacier", id: glacier.id, trace: selected, scene: sceneId,
      seasons: seasons.size < SEASONS.length ? SEASONS.filter((s) => seasons.has(s)) : undefined,
      color: bySeason.checked ? "season" : undefined }));

    chart.select(trace?.date.slice(0, 7));
    const i = list.findIndex((t) => t.trace_id === selected);
    slider.max = String(Math.max(list.length - 1, 0));
    slider.value = String(Math.max(i, 0));
    prev.disabled = i <= 0;
    next.disabled = i < 0 || i >= list.length - 1;
    position.textContent = list.length ? `Trace ${i + 1} of ${list.length.toLocaleString()}` : "No traces for these sensors and seasons";

    traceInfo.replaceChildren(...(trace ? [
      ["Date", trace.date], ["Sensor", SENSOR_NAMES[trace.sensor]], ["Season", trace.season],
      ["Uncertainty", trace.uncertainty_m == null ? "—" : `±${trace.uncertainty_m.toFixed(1)} m`], ["Trace", trace.trace_id],
    ].flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]) : []));
    renderSceneInfo(sceneInfo, trace, ranked, scene, (id) => { sceneId = id; update(); });

    if (!map.getLayer("traces")) return; // onStyle above calls update() again
    map.setFilter("traces", ["all", ["in", ["get", "sensor"], ["literal", [...sensors]]],
      ["in", ["get", "season"], ["literal", [...seasons]]]]);
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
