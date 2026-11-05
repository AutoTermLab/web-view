import { describe, expect, it } from "vitest";
import { clampPanel } from "./layout";

describe("clampPanel", () => {
  it("keeps the panel at least 288 px and leaves the map at least 320 px", () => {
    expect(clampPanel(500, 1280)).toBe(500);
    expect(clampPanel(100, 1280)).toBe(288);
    expect(clampPanel(1200, 1280)).toBe(960);
    expect(clampPanel(400.6, 1280)).toBe(401);
  });

  it("lets the panel minimum win on a narrow window", () => {
    expect(clampPanel(500, 500)).toBe(288);
  });
});
