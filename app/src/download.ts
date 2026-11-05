// Downloading the shown traces as a zipped shapefile, built in the browser from the loaded display geometry
// (docs/update-plan.md §4).
import { shapefile, type TraceFeature } from "./shapefile";
import { zip } from "./zip";

export const SIMPLIFIED_NOTE =
  "Simplified display geometry, within 6 m of the original. For full resolution, download the GeoPackage.";

export const CITATION = "Zhang, E., Catania, G., and Trugman, D. T.: AutoTerm: an automated pipeline for glacier terminus " +
  "extraction using machine learning and a \"big data\" repository of Greenland glacier termini, The Cryosphere, 17, " +
  "3485–3503, https://doi.org/10.5194/tc-17-3485-2023, 2023.";

/** "GID85_traces", plus the chosen sensors and seasons when they leave some out: "GID85_traces_S1-S2_DJF". */
export function traceDownloadName(id: string, sensors: string[], available: string[], seasons: string[]): string {
  const parts = [`${id}_traces`];
  if (sensors.length < available.length) parts.push(sensors.join("-"));
  if (seasons.length < 4) parts.push(seasons.join("-"));
  return parts.join("_");
}

export function tracesZip(stem: string, features: TraceFeature[], readme: string): Blob {
  const files = shapefile(features);
  return zip([
    ...(["shp", "shx", "dbf", "prj", "cpg"] as const).map((ext) => ({ name: `${stem}.${ext}`, data: files[ext] })),
    { name: "README.txt", data: new TextEncoder().encode(readme) },
  ]);
}

export function traceReadme(o: { glacier: string; version: string; count: number; filters: string; stem: string;
                                  geopackage: string; site: string; date: string }): string {
  return `AutoTerm glacier terminus traces: ${o.glacier}
Data version ${o.version}, downloaded ${o.date} from ${o.site}

${o.count.toLocaleString("en")} trace${o.count === 1 ? "" : "s"}: ${o.filters}.

${SIMPLIFIED_NOTE}
GeoPackage: ${o.geopackage}

Files: ${o.stem}.shp, .shx, .dbf, .prj, .cpg (PolyLine, WGS 84 longitude/latitude, EPSG:4326).
Fields:
  trace_id  glacier, date and sensor
  date      acquisition date of the scene the trace was drawn on
  sensor    L5, L7, L8 (Landsat 5, 7, 8), S1, S2 (Sentinel-1, Sentinel-2)
  season    meteorological season: DJF, MAM, JJA, SON
  uncert_m  uncertainty in metres, blank if not given
  status    AutoTerm screening result

Please cite: ${CITATION}
`.replaceAll("\n", "\r\n"); // Notepad-friendly
}

/** Hand a Blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
