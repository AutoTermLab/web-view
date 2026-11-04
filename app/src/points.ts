// The overview map's markers: one point per glacier at its lat/lon from glaciers.json.
import type { FeatureCollection, Point } from "geojson";
import type { Glacier } from "./data";

export type GlacierPoint = { id: string; label: string; traces: number };

export function glacierPoints(glaciers: Glacier[]): FeatureCollection<Point, GlacierPoint> {
  return {
    type: "FeatureCollection",
    features: glaciers.map((g) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [g.lon, g.lat] },
      properties: { id: g.id, label: g.name ?? g.id, traces: g.counts.total },
    })),
  };
}
