import { describe, expect, it } from "vitest";
import { traceDownloadName, tracesZip } from "./download";

const all = { sensors: ["L5", "L7", "L8", "S1", "S2"], seasons: ["DJF", "MAM", "JJA", "SON"] };

describe("traceDownloadName", () => {
  it("records the sensor and season filters, and leaves out a filter that keeps everything", () => {
    expect(traceDownloadName("GID85", all.sensors, all.sensors, all.seasons)).toBe("GID85_traces");
    expect(traceDownloadName("GID85", ["S1", "S2"], all.sensors, ["DJF"])).toBe("GID85_traces_S1-S2_DJF");
    expect(traceDownloadName("GID85", all.sensors, all.sensors, ["MAM", "JJA"])).toBe("GID85_traces_MAM-JJA");
    // a glacier without Landsat 5: all of its sensors chosen is "everything"
    expect(traceDownloadName("GID1", ["L7", "L8", "S1", "S2"], ["L7", "L8", "S1", "S2"], all.seasons)).toBe("GID1_traces");
  });
});

describe("tracesZip", () => {
  it("holds the five shapefile parts and a README with the simplification note", async () => {
    const features = [{
      geometry: { coordinates: [[-50, 69], [-49, 69.1]] },
      properties: { trace_id: "GID1_19850304_L5", date: "1985-03-04", sensor: "L5", season: "MAM", uncertainty_m: 10, status: "passed" },
    }];
    const bytes = new Uint8Array(await tracesZip("GID1_traces", features, "README body").arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    for (const ext of ["shp", "shx", "dbf", "prj", "cpg"]) expect(text).toContain(`GID1_traces.${ext}`);
    expect(text).toContain("README.txt");
    expect(text).toContain("README body");
  });
});
