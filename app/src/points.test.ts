import { describe, expect, it } from "vitest";
import type { Glacier } from "./data";
import { glacierPoints } from "./points";

const glacier = (id: string, name: string | null, lon: number, lat: number, total: number) =>
  ({ id, name, lon, lat, counts: { total } }) as Glacier;

describe("glacierPoints", () => {
  it("puts each glacier at its lon/lat, labelled by id, then name when there is one", () => {
    const points = glacierPoints([glacier("GID1", "Kangilliup Sermia", -51.56, 71.76, 1296), glacier("GID2", null, -50.1, 69.2, 78)]);
    expect(points.features).toEqual([
      { type: "Feature", geometry: { type: "Point", coordinates: [-51.56, 71.76] },
        properties: { id: "GID1", label: "GID1 · Kangilliup Sermia", traces: 1296 } },
      { type: "Feature", geometry: { type: "Point", coordinates: [-50.1, 69.2] },
        properties: { id: "GID2", label: "GID2", traces: 78 } },
    ]);
  });
});
