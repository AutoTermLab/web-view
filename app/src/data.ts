// The one place that knows the bucket layout (plan §4): versioned data under <base>/<version>/, imagery under <base>/images/.
import type { FeatureCollection, LineString } from "geojson";
import type { Scene, Trace } from "./scenes";

export const DATA_BASE_URL: string =
  import.meta.env.VITE_DATA_BASE_URL || "https://autoterm.bandicoots.net/autoterm"; // empty in CI when unset

export const versionUrl = (base: string, version: string, path: string) => `${base}/${version}/${path}`;
export const imagesIndexUrl = (base: string, glacier: string) => `${base}/images/${glacier}/images.json`;
export const imageUrl = (base: string, image: string) => `${base}/images/${image}`;

export interface Glacier {
  id: string;
  num: number;
  name: string | null;
  lat: number;
  lon: number;
  bbox: [number, number, number, number];
  date_range: [string, string];
  counts: { total: number; by_sensor: Record<string, number> };
  files: { traces: string; download_traces: string }; // download_traces: the full-resolution GeoPackage
}

export type Traces = FeatureCollection<LineString, Trace>;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

let index: Promise<{ version: string; glaciers: Glacier[] }> | undefined;

/** latest.json, then that version's glaciers.json; fetched once per page load. */
export function loadGlaciers() {
  index ??= (async () => {
    const { version } = await getJson<{ version: string }>(`${DATA_BASE_URL}/latest.json`);
    const { glaciers } = await getJson<{ glaciers: Glacier[] }>(versionUrl(DATA_BASE_URL, version, "glaciers.json"));
    return { version, glaciers };
  })();
  index.catch(() => (index = undefined)); // let a retry fetch again
  return index;
}

export async function loadGlacier(id: string) {
  const { version, glaciers } = await loadGlaciers();
  const glacier = glaciers.find((g) => g.id === id);
  if (!glacier) throw new Error(`No glacier ${id} in ${version}`);
  const [traces, images] = await Promise.all([
    getJson<Traces>(versionUrl(DATA_BASE_URL, version, glacier.files.traces)),
    getJson<{ scenes: Scene[] }>(imagesIndexUrl(DATA_BASE_URL, id)),
  ]);
  return { glacier, traces, scenes: images.scenes };
}
