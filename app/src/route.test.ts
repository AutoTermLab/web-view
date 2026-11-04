import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "./route";

describe("parseRoute", () => {
  it("defaults to the glacier list", () => {
    expect(parseRoute("")).toEqual({ view: "list" });
    expect(parseRoute("#/")).toEqual({ view: "list" });
    expect(parseRoute("#/nonsense")).toEqual({ view: "list" });
  });

  it("reads a glacier with its selected trace and scene", () => {
    expect(parseRoute("#/glacier/GID278?trace=GID278_19850610_L5&scene=LT05_008011_19850610")).toEqual({
      view: "glacier", id: "GID278", trace: "GID278_19850610_L5", scene: "LT05_008011_19850610",
    });
    expect(parseRoute("#/glacier/GID1")).toEqual({ view: "glacier", id: "GID1" });
  });
});

describe("formatRoute", () => {
  it("round-trips", () => {
    for (const hash of ["#/", "#/glacier/GID1", "#/glacier/GID278?trace=GID278_19850610_L5&scene=LT05_008011_19850610"]) {
      expect(formatRoute(parseRoute(hash))).toBe(hash);
    }
  });
});
