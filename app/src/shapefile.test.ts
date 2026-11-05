import { describe, expect, it } from "vitest";
import { shapefile } from "./shapefile";

const feature = (trace_id: string, date: string, uncertainty_m: number | null, coordinates: [number, number][]) => ({
  type: "Feature" as const,
  geometry: { type: "LineString" as const, coordinates },
  properties: { trace_id, date, sensor: "L5", season: "MAM", uncertainty_m, status: "passed" },
});

describe("shapefile", () => {
  const files = shapefile([
    feature("GID1_19850304_L5", "1985-03-04", 69.2519, [[-50, 69], [-49.5, 69.25], [-49, 69.1]]),
    feature("GID1_19850401_L5", "1985-04-01", null, [[-51, 68.9], [-50.5, 69]]),
  ]);

  it("writes a PolyLine .shp: header, bounding box, one record per trace", () => {
    const v = new DataView(files.shp.buffer);
    expect(files.shp.length).toBe(100 + (8 + 96) + (8 + 80)); // content: 44 + 4 per part + 16 per point
    expect(v.getInt32(0)).toBe(9994);
    expect(v.getInt32(24)).toBe(files.shp.length / 2); // in 16-bit words, big-endian
    expect(v.getInt32(28, true)).toBe(1000);
    expect(v.getInt32(32, true)).toBe(3);
    expect([36, 44, 52, 60].map((at) => v.getFloat64(at, true))).toEqual([-51, 68.9, -49, 69.25]);

    expect(v.getInt32(100)).toBe(1); // record number
    expect(v.getInt32(104)).toBe(48); // content length in words
    expect(v.getInt32(108, true)).toBe(3);
    expect([112, 120, 128, 136].map((at) => v.getFloat64(at, true))).toEqual([-50, 69, -49, 69.25]);
    expect(v.getInt32(144, true)).toBe(1); // parts
    expect(v.getInt32(148, true)).toBe(3); // points
    expect(v.getInt32(152, true)).toBe(0); // the part starts at point 0
    expect([156, 164].map((at) => v.getFloat64(at, true))).toEqual([-50, 69]);
    expect(v.getInt32(204)).toBe(2);
  });

  it("indexes the records in the .shx", () => {
    const v = new DataView(files.shx.buffer);
    expect(files.shx.length).toBe(116);
    expect(v.getInt32(24)).toBe(58);
    expect([v.getInt32(100), v.getInt32(104), v.getInt32(108), v.getInt32(112)]).toEqual([50, 48, 102, 40]);
  });

  it("writes the attributes as a dBase table, blank for a missing uncertainty", () => {
    const v = new DataView(files.dbf.buffer);
    expect(files.dbf[0]).toBe(3);
    expect(v.getUint32(4, true)).toBe(2);
    expect(v.getUint16(8, true)).toBe(32 + 6 * 32 + 1);
    expect(v.getUint16(10, true)).toBe(1 + 32 + 8 + 4 + 3 + 12 + 10);
    const text = new TextDecoder().decode(files.dbf);
    expect(text.slice(32, 40)).toBe("trace_id");
    const records = text.slice(225, 225 + 140);
    expect(records.slice(0, 70)).toBe(` ${"GID1_19850304_L5".padEnd(32)}19850304L5  MAM${"69.252".padStart(12)}${"passed".padEnd(10)}`);
    expect(records.slice(70 + 1 + 32 + 8 + 4 + 3, 70 + 1 + 32 + 8 + 4 + 3 + 12)).toBe(" ".repeat(12));
    expect(files.dbf.at(-1)).toBe(0x1a);
  });

  it("declares WGS 84 and UTF-8", () => {
    expect(new TextDecoder().decode(files.prj)).toMatch(/^GEOGCS\["GCS_WGS_1984"/);
    expect(new TextDecoder().decode(files.cpg)).toBe("UTF-8");
  });
});
