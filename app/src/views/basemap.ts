// OpenFreeMap "Positron", a plain light-grey map (OpenStreetMap data, no API key). If its style can't be fetched, fall back to a blank
// background, so the data still shows: a style that fails to load would stop the whole map.
import type { StyleSpecification } from "maplibre-gl";

const BASEMAP_URL = "https://tiles.openfreemap.org/styles/positron";
const FALLBACK: StyleSpecification = {
  version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#e9ebee" } }],
};
let basemap: Promise<StyleSpecification> | undefined;
export const loadBasemap = () => basemap ??= fetch(BASEMAP_URL)
  .then((r) => { if (!r.ok) throw new Error(`${r.status} for ${BASEMAP_URL}`); return r.json(); })
  .catch((error) => { console.warn("Basemap unavailable, using a blank background:", error); return FALLBACK; });
