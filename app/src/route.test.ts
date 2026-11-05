import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "./route";

describe("parseRoute", () => {
  it("defaults to the overview map", () => {
    expect(parseRoute("")).toEqual({ view: "overview" });
    expect(parseRoute("#/")).toEqual({ view: "overview" });
    expect(parseRoute("#/nonsense")).toEqual({ view: "overview" });
  });

  it("reads the glacier list", () => {
    expect(parseRoute("#/list")).toEqual({ view: "list" });
  });

  it("reads a glacier with its selected trace and scene", () => {
    expect(parseRoute("#/glacier/GID278?trace=GID278_19850610_L5&scene=LT05_008011_19850610")).toEqual({
      view: "glacier", id: "GID278", trace: "GID278_19850610_L5", scene: "LT05_008011_19850610",
    });
    expect(parseRoute("#/glacier/GID1")).toEqual({ view: "glacier", id: "GID1" });
  });

  it("reads the chosen seasons", () => {
    expect(parseRoute("#/glacier/GID85?season=DJF")).toEqual({ view: "glacier", id: "GID85", seasons: ["DJF"] });
    expect(parseRoute("#/glacier/GID85?trace=t&season=MAM&season=JJA")).toEqual({
      view: "glacier", id: "GID85", trace: "t", seasons: ["MAM", "JJA"],
    });
  });
});

describe("formatRoute", () => {
  it("round-trips", () => {
    for (const hash of ["#/", "#/list", "#/glacier/GID1", "#/glacier/GID278?trace=GID278_19850610_L5&scene=LT05_008011_19850610",
                        "#/glacier/GID85?trace=t&scene=s&season=DJF&season=JJA"]) {
      expect(formatRoute(parseRoute(hash))).toBe(hash);
    }
  });
});
