import { describe, expect, it } from "vitest";
import { countClass, coverage, MONTH_SEASONS } from "./coverage";
import type { Trace } from "./scenes";

const trace = (trace_id: string, date: string, sensor: string, season: string): Trace =>
  ({ trace_id, date, sensor, season, uncertainty_m: 10 });

describe("coverage", () => {
  const traces = [
    trace("a", "2015-12-01", "S1", "DJF"), trace("b", "2015-12-20", "S1", "DJF"), trace("c", "2015-12-21", "L8", "DJF"),
    trace("d", "2016-01-05", "S1", "DJF"), trace("e", "2016-07-01", "L8", "JJA"),
  ];

  it("counts the traces of each calendar month by sensor; December stays in its own year", () => {
    const cells = coverage(traces, new Set(["S1", "L8"]));
    expect(cells.get("2015-12")).toEqual({ S1: 2, L8: 1 });
    expect(cells.get("2016-01")).toEqual({ S1: 1 });
    expect(cells.get("2016-07")).toEqual({ L8: 1 });
    expect(cells.has("2016-02")).toBe(false);
  });

  it("counts only the chosen sensors", () => {
    const cells = coverage(traces, new Set(["S1"]));
    expect(cells.get("2015-12")).toEqual({ S1: 2 });
    expect(cells.has("2016-07")).toBe(false);
  });

  it("maps each month to its meteorological season, December to winter", () => {
    expect(MONTH_SEASONS).toEqual(["DJF", "DJF", "MAM", "MAM", "MAM", "JJA", "JJA", "JJA", "SON", "SON", "SON", "DJF"]);
  });
});

describe("countClass", () => {
  it("bins counts by doubling: 0 | 1 | 2–3 | 4–7 | 8–15 | 16+", () => {
    expect([0, 1, 2, 3, 4, 7, 8, 15, 16, 40].map(countClass)).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});
