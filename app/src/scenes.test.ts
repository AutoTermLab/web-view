import { describe, expect, it } from "vitest";
import { nearest, rankScenes, scenesByTrace, step, visibleTraces, type Scene, type Trace } from "./scenes";

const scene = (id: string, traces: string[]): Scene => ({
  id, date: "2020-01-01", sensor: "S2", image: `GID1/${id}.avif`, corners: [[0, 1], [1, 1], [1, 0], [0, 0]], traces,
});
const trace = (trace_id: string, date: string, sensor: string, season = "DJF"): Trace =>
  ({ trace_id, date, sensor, season, uncertainty_m: 10, status: "passed" });

describe("scenesByTrace", () => {
  it("lists every scene a trace was linked to, in id order", () => {
    const index = scenesByTrace([scene("B", ["t1", "t2"]), scene("A", ["t1"])]);
    expect(index.get("t1")!.map((s) => s.id)).toEqual(["A", "B"]);
    expect(index.get("t2")!.map((s) => s.id)).toEqual(["B"]);
    expect(index.get("t3")).toBeUndefined();
  });
});

describe("rankScenes", () => {
  // corners are top-left, top-right, bottom-right, bottom-left in lon/lat
  const box = (id: string, w: number, s: number, e: number, n: number): Scene =>
    ({ ...scene(id, ["t1"]), corners: [[w, n], [e, n], [e, s], [w, s]] });

  it("puts the scene holding most of the trace first, with its share of the vertices", () => {
    const trace: [number, number][] = [[0.5, 0.5], [1.5, 0.5], [2.5, 0.5], [3.5, 0.5]];
    const sliver = box("A", 3.9, 0, 4, 1); // holds none of the vertices
    const half = box("B", 0, 0, 2, 1); // holds two
    const most = box("C", 1, 0, 4, 1); // holds three
    expect(rankScenes([sliver, half, most], trace)).toEqual([
      { scene: most, share: 0.75 }, { scene: half, share: 0.5 }, { scene: sliver, share: 0 },
    ]);
  });
});

describe("visibleTraces", () => {
  const all = new Set(["DJF", "MAM", "JJA", "SON"]);

  it("keeps the chosen sensors, sorted by date then id", () => {
    const traces = [trace("c", "2020-03-01", "S2"), trace("a", "2019-01-01", "L8"), trace("b", "2020-03-01", "S1")];
    expect(visibleTraces(traces, new Set(["S1", "S2"]), all).map((t) => t.trace_id)).toEqual(["b", "c"]);
  });

  it("keeps the chosen seasons too", () => {
    const traces = [trace("a", "2020-01-01", "S1", "DJF"), trace("b", "2020-07-01", "S1", "JJA"),
                    trace("c", "2020-07-02", "L8", "JJA"), trace("d", "2020-10-01", "S1", "SON")];
    expect(visibleTraces(traces, new Set(["S1"]), new Set(["DJF", "JJA"])).map((t) => t.trace_id)).toEqual(["a", "b"]);
  });
});

describe("step and nearest", () => {
  const list = [trace("a", "2019-01-01", "L8"), trace("b", "2020-01-01", "L8"), trace("c", "2021-01-01", "L8")];

  it("moves through the list and stops at the ends", () => {
    expect(step(list, "a", 1)).toBe("b");
    expect(step(list, "a", -1)).toBe("a");
    expect(step(list, "c", 1)).toBe("c");
  });

  it("picks the first trace on or after a date, else the last", () => {
    expect(nearest(list, "2019-06-01")).toBe("b");
    expect(nearest(list, "2020-01-01")).toBe("b");
    expect(nearest(list, "2022-01-01")).toBe("c");
    expect(nearest([], "2022-01-01")).toBeUndefined();
  });
});
