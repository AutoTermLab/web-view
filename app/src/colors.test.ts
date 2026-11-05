import { describe, expect, it } from "vitest";
import { SEASON_COLORS, SENSOR_COLORS, traceColor } from "./colors";

describe("traceColor", () => {
  it("colors traces by sensor or by season, white for anything unknown", () => {
    expect(traceColor("sensor")).toEqual(["match", ["get", "sensor"], ...Object.entries(SENSOR_COLORS).flat(), "#fff"]);
    expect(traceColor("season")).toEqual(["match", ["get", "season"], ...Object.entries(SEASON_COLORS).flat(), "#fff"]);
    expect(Object.keys(SEASON_COLORS)).toEqual(["DJF", "MAM", "JJA", "SON"]);
  });
});
