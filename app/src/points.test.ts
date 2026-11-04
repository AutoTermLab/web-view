import { describe, expect, it } from "vitest";
import type { Glacier } from "./data";
import { glacierPoints } from "./points";

const glacier = (id: string, name: string | null, lon: number, lat: number, total: number) =>
  ({ id, name, lon, lat, counts: { total } }) as Glacier;

describe("glacierPoints", () => {
  it("puts each glacier at its lon/lat, labelled by name or else by id", () => {
    const points = glacierPoints([glacier("GID1", "Kangilliup Sermia", -51.56, 71.76, 1296), glacier("GID2", null, -50.1, 69.2, 78)]);
    expect(points.features).toEqual([
      { type: "Feature", geometry: { type: "Point", coordinates: [-51.56, 71.76] },
        properties: { id: "GID1", label: "Kangilliup Sermia", traces: 1296 } },
      { type: "Feature", geometry: { type: "Point", coordinates: [-50.1, 69.2] },
        properties: { id: "GID2", label: "GID2", traces: 78 } },
    ]);
  });
});
